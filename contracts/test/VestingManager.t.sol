// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {VestingManager} from "../src/VestingManager.sol";
import {IVestingManager} from "../src/IVestingManager.sol";
import {MockToken} from "../src/MockToken.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";
import {FeeToken} from "./mocks/FeeToken.sol";

/// Estructura de la clase 13 adaptada a Foundry:
///   describe/it -> contrato de test / funciones test_*
///   loadFixture -> setUp() (estado limpio en cada test)
///   revertedWithCustomError -> vm.expectRevert(Error.selector)
///   emit().withArgs -> vm.expectEmit
///   time.setNextBlockTimestamp -> vm.warp
/// Para los plazos se prueba siempre: antes, exactamente en el limite y despues.
contract VestingManagerTest is Test {
    VestingManager internal vesting;
    MockToken internal token;

    address internal payer = makeAddr("payer");
    address internal beneficiary = makeAddr("beneficiary");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant AMOUNT = 1_000e6; // 1000 tokens de 6 decimales
    uint256 internal constant DURATION = 1_000; // segundos, para que el vesting sea 1 token por segundo
    uint48 internal start;
    uint48 internal end;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockToken("Test USD", "tUSD", 6);
        vesting = new VestingManager();

        token.mint(payer, 10 * AMOUNT);
        vm.prank(payer);
        token.approve(address(vesting), type(uint256).max);

        start = uint48(block.timestamp + 100);
        end = start + uint48(DURATION);
    }

    // ----------------------------------------------------------------- helpers

    function _create(bool revocable) internal returns (uint256 id) {
        return _createFull(AMOUNT, start, end, revocable);
    }

    function _createFull(uint256 amount, uint48 s, uint48 e, bool revocable) internal returns (uint256 id) {
        vm.prank(payer);
        id = vesting.createAgreement(address(token), beneficiary, amount, s, e, revocable);
    }

    function _claim(uint256 id) internal {
        vm.prank(beneficiary);
        vesting.claim(id);
    }

    function _cancel(uint256 id) internal {
        vm.prank(payer);
        vesting.cancel(id);
    }

    // ============================================================ 1. Creacion

    function test_create_valid() public {
        uint256 payerBefore = token.balanceOf(payer);

        vm.expectEmit(true, true, true, true);
        emit IVestingManager.AgreementCreated(1, payer, beneficiary, address(token), AMOUNT, start, end, true);
        uint256 id = _create(true);

        assertEq(id, 1);
        assertEq(token.balanceOf(address(vesting)), AMOUNT, "el contrato bloquea el total");
        assertEq(token.balanceOf(payer), payerBefore - AMOUNT);

        IVestingManager.Agreement memory a = vesting.getAgreement(id);
        assertEq(a.payer, payer);
        assertEq(a.beneficiary, beneficiary);
        assertEq(a.token, address(token));
        assertEq(a.totalAmount, AMOUNT);
        assertEq(a.claimedAmount, 0);
        assertEq(a.vestedAtCancel, 0);
        assertEq(a.startTime, start);
        assertEq(a.endTime, end);
        assertTrue(a.revocable);
        assertEq(uint8(a.status), uint8(IVestingManager.Status.Active));
    }

    function test_create_idsAreUniqueAndListed() public {
        uint256 id1 = _create(true);
        uint256 id2 = _create(false);
        assertEq(id1, 1);
        assertEq(id2, 2);

        uint256[] memory byPayer = vesting.getAgreementsByPayer(payer);
        uint256[] memory byBeneficiary = vesting.getAgreementsByBeneficiary(beneficiary);
        assertEq(byPayer.length, 2);
        assertEq(byPayer[0], 1);
        assertEq(byPayer[1], 2);
        assertEq(byBeneficiary.length, 2);
        assertEq(vesting.getAgreementsByPayer(stranger).length, 0);
    }

    function test_create_pastStartIsAllowedIfEndIsFuture() public {
        uint48 pastStart = uint48(block.timestamp - 500);
        uint256 id = _createFull(AMOUNT, pastStart, end, true);
        assertGt(vesting.vestedAmount(id), 0, "ya devengo algo");
    }

    function test_create_revertsOnInvalidParams() public {
        vm.startPrank(payer);

        vm.expectRevert(IVestingManager.ZeroAddress.selector);
        vesting.createAgreement(address(0), beneficiary, AMOUNT, start, end, true);

        vm.expectRevert(IVestingManager.InvalidBeneficiary.selector);
        vesting.createAgreement(address(token), address(0), AMOUNT, start, end, true);

        vm.expectRevert(IVestingManager.InvalidBeneficiary.selector);
        vesting.createAgreement(address(token), address(vesting), AMOUNT, start, end, true);

        vm.expectRevert(IVestingManager.ZeroAmount.selector);
        vesting.createAgreement(address(token), beneficiary, 0, start, end, true);

        vm.stopPrank();
    }

    function test_create_revertsOnInvalidTimes() public {
        vm.startPrank(payer);

        // fin igual al inicio
        vm.expectRevert(IVestingManager.InvalidTimeRange.selector);
        vesting.createAgreement(address(token), beneficiary, AMOUNT, start, start, true);

        // fin anterior al inicio
        vm.expectRevert(IVestingManager.InvalidTimeRange.selector);
        vesting.createAgreement(address(token), beneficiary, AMOUNT, end, start, true);

        // fin en el pasado (aunque sea posterior al inicio)
        uint48 pastEnd = uint48(block.timestamp - 1);
        vm.expectRevert(IVestingManager.InvalidTimeRange.selector);
        vesting.createAgreement(address(token), beneficiary, AMOUNT, pastEnd - 10, pastEnd, true);

        // fin exactamente ahora
        vm.expectRevert(IVestingManager.InvalidTimeRange.selector);
        vesting.createAgreement(address(token), beneficiary, AMOUNT, start - 200, uint48(block.timestamp), true);

        vm.stopPrank();
    }

    function test_create_revertsWithoutEnoughAllowance() public {
        token.mint(stranger, AMOUNT); // tiene saldo pero no aprobo

        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vesting), 0, AMOUNT)
        );
        vm.prank(stranger);
        vesting.createAgreement(address(token), beneficiary, AMOUNT, start, end, true);
    }

    function test_create_revertsWithPartialAllowance() public {
        token.mint(stranger, AMOUNT);
        vm.startPrank(stranger);
        token.approve(address(vesting), AMOUNT - 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(vesting), AMOUNT - 1, AMOUNT
            )
        );
        vesting.createAgreement(address(token), beneficiary, AMOUNT, start, end, true);
        vm.stopPrank();
    }

    function test_create_revertsWithoutEnoughBalance() public {
        vm.startPrank(stranger);
        token.approve(address(vesting), AMOUNT);

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, stranger, 0, AMOUNT));
        vesting.createAgreement(address(token), beneficiary, AMOUNT, start, end, true);
        vm.stopPrank();
    }

    function test_create_revertsWithFeeOnTransferToken() public {
        FeeToken feeToken = new FeeToken();
        feeToken.mint(payer, AMOUNT);
        vm.startPrank(payer);
        feeToken.approve(address(vesting), AMOUNT);

        vm.expectRevert(IVestingManager.FeeOnTransferNotSupported.selector);
        vesting.createAgreement(address(feeToken), beneficiary, AMOUNT, start, end, true);
        vm.stopPrank();
    }

    // ================================================================ 2. Devengado

    function test_vested_beforeStartIsZero() public {
        uint256 id = _create(true);
        vm.warp(start - 1);
        assertEq(vesting.vestedAmount(id), 0);
        assertEq(vesting.claimableAmount(id), 0);
    }

    function test_vested_exactlyAtStartIsZero() public {
        uint256 id = _create(true);
        vm.warp(start);
        assertEq(vesting.vestedAmount(id), 0);
    }

    function test_vested_duringPeriodIsProportional() public {
        uint256 id = _create(true);

        vm.warp(start + 1);
        assertEq(vesting.vestedAmount(id), AMOUNT / DURATION);

        vm.warp(start + 250);
        assertEq(vesting.vestedAmount(id), 250e6);

        vm.warp(start + 500);
        assertEq(vesting.vestedAmount(id), 500e6);
        assertEq(vesting.claimableAmount(id), 500e6);
    }

    function test_vested_atEndIsTotal() public {
        uint256 id = _create(true);
        vm.warp(end - 1);
        assertLt(vesting.vestedAmount(id), AMOUNT, "un segundo antes todavia no esta todo");
        vm.warp(end);
        assertEq(vesting.vestedAmount(id), AMOUNT);
    }

    function test_vested_afterEndStaysAtTotal() public {
        uint256 id = _create(true);
        vm.warp(end + 365 days);
        assertEq(vesting.vestedAmount(id), AMOUNT);
    }

    // ================================================================== 3. Reclamos

    function test_claim_partial() public {
        uint256 id = _create(true);
        vm.warp(start + 500);

        vm.expectEmit(true, true, false, true);
        emit IVestingManager.Claimed(id, beneficiary, 500e6);
        _claim(id);

        assertEq(token.balanceOf(beneficiary), 500e6);
        assertEq(token.balanceOf(address(vesting)), 500e6);
        assertEq(vesting.getAgreement(id).claimedAmount, 500e6);
        assertEq(vesting.claimableAmount(id), 0);
        assertEq(uint8(vesting.getAgreement(id).status), uint8(IVestingManager.Status.Active));
    }

    function test_claim_multipleClaimsAddUpToTotalAndComplete() public {
        uint256 id = _create(true);

        vm.warp(start + 250);
        _claim(id);
        assertEq(token.balanceOf(beneficiary), 250e6);

        vm.warp(start + 600);
        _claim(id);
        assertEq(token.balanceOf(beneficiary), 600e6);

        vm.warp(end + 1);
        _claim(id);
        assertEq(token.balanceOf(beneficiary), AMOUNT);
        assertEq(token.balanceOf(address(vesting)), 0);
        assertEq(uint8(vesting.getAgreement(id).status), uint8(IVestingManager.Status.Completed));
    }

    function test_claim_doubleClaimReverts() public {
        uint256 id = _create(true);
        vm.warp(start + 500);
        _claim(id);

        vm.expectRevert(IVestingManager.NothingToClaim.selector);
        _claim(id);
    }

    function test_claim_afterFullClaimReverts() public {
        uint256 id = _create(true);
        vm.warp(end);
        _claim(id);

        vm.warp(end + 100);
        vm.expectRevert(IVestingManager.NothingToClaim.selector);
        _claim(id);
    }

    function test_claim_beforeStartReverts() public {
        uint256 id = _create(true);
        vm.warp(start - 1);
        vm.expectRevert(IVestingManager.NothingToClaim.selector);
        _claim(id);
    }

    function test_claim_exactlyAtStartReverts() public {
        uint256 id = _create(true);
        vm.warp(start);
        vm.expectRevert(IVestingManager.NothingToClaim.selector);
        _claim(id);
    }

    function test_claim_byUnauthorizedAccountReverts() public {
        uint256 id = _create(true);
        vm.warp(start + 500);

        vm.expectRevert(IVestingManager.NotBeneficiary.selector);
        vm.prank(stranger);
        vesting.claim(id);

        // ni siquiera el pagador puede reclamar
        vm.expectRevert(IVestingManager.NotBeneficiary.selector);
        vm.prank(payer);
        vesting.claim(id);
    }

    function test_claim_nonexistentIdReverts() public {
        vm.expectRevert(IVestingManager.AgreementNotFound.selector);
        _claim(999);

        vm.expectRevert(IVestingManager.AgreementNotFound.selector);
        _claim(0);
    }

    // ================================================================ 4. Cancelacion

    function test_cancel_valid() public {
        uint256 id = _create(true);
        uint256 payerBefore = token.balanceOf(payer);
        vm.warp(start + 250);

        vm.expectEmit(true, true, false, true);
        emit IVestingManager.AgreementCancelled(id, payer, 750e6, 250e6);
        _cancel(id);

        IVestingManager.Agreement memory a = vesting.getAgreement(id);
        assertEq(uint8(a.status), uint8(IVestingManager.Status.Cancelled));
        assertEq(a.vestedAtCancel, 250e6);
        assertEq(token.balanceOf(payer), payerBefore + 750e6, "el pagador recupera lo no devengado");
    }

    function test_cancel_byUnauthorizedAccountReverts() public {
        uint256 id = _create(true);
        vm.warp(start + 250);

        vm.expectRevert(IVestingManager.NotPayer.selector);
        vm.prank(stranger);
        vesting.cancel(id);

        // el beneficiario tampoco puede cancelar
        vm.expectRevert(IVestingManager.NotPayer.selector);
        vm.prank(beneficiary);
        vesting.cancel(id);
    }

    function test_cancel_nonRevocableReverts() public {
        uint256 id = _create(false);
        vm.warp(start + 250);

        vm.expectRevert(IVestingManager.NotRevocable.selector);
        _cancel(id);
    }

    function test_cancel_refundsExactlyTheUnvestedAmount() public {
        uint256 id = _create(true);
        vm.warp(start + 400);
        _cancel(id);

        // en el contrato queda exactamente lo devengado (400) para el beneficiario
        assertEq(token.balanceOf(address(vesting)), 400e6);
        assertEq(token.balanceOf(payer), 10 * AMOUNT - 400e6);
    }

    function test_cancel_preservesVestedAmountForBeneficiary() public {
        uint256 id = _create(true);
        vm.warp(start + 250);
        _cancel(id);

        // el devengado queda congelado aunque pase el tiempo
        vm.warp(end + 1 days);
        assertEq(vesting.vestedAmount(id), 250e6);
        assertEq(vesting.claimableAmount(id), 250e6);

        _claim(id);
        assertEq(token.balanceOf(beneficiary), 250e6);
        assertEq(token.balanceOf(address(vesting)), 0);
    }

    function test_cancel_claimAfterCancelThenNothingLeft() public {
        uint256 id = _create(true);
        vm.warp(start + 250);
        _cancel(id);
        _claim(id);

        vm.expectRevert(IVestingManager.NothingToClaim.selector);
        _claim(id);
    }

    function test_cancel_partialClaimBeforeCancel() public {
        uint256 id = _create(true);
        vm.warp(start + 200);
        _claim(id); // retira 200

        vm.warp(start + 500);
        _cancel(id); // devengado 500, devuelve 500

        assertEq(vesting.claimableAmount(id), 300e6, "500 devengado - 200 ya reclamado");
        _claim(id);
        assertEq(token.balanceOf(beneficiary), 500e6);
        assertEq(token.balanceOf(address(vesting)), 0);
    }

    function test_cancel_beforeStartReturnsEverything() public {
        uint256 id = _create(true);
        uint256 payerBefore = token.balanceOf(payer);
        _cancel(id);

        assertEq(token.balanceOf(payer), payerBefore + AMOUNT);
        assertEq(token.balanceOf(address(vesting)), 0);
        assertEq(vesting.claimableAmount(id), 0);

        vm.warp(end + 1);
        vm.expectRevert(IVestingManager.NothingToClaim.selector);
        _claim(id);
    }

    function test_cancel_oneSecondBeforeEndWorks() public {
        uint256 id = _create(true);
        vm.warp(end - 1);
        _cancel(id);
        assertEq(vesting.getAgreement(id).vestedAtCancel, AMOUNT - AMOUNT / DURATION);
    }

    function test_cancel_exactlyAtEndReverts() public {
        uint256 id = _create(true);
        vm.warp(end);
        vm.expectRevert(IVestingManager.AlreadyEnded.selector);
        _cancel(id);
    }

    function test_cancel_afterEndReverts() public {
        uint256 id = _create(true);
        vm.warp(end + 1);
        vm.expectRevert(IVestingManager.AlreadyEnded.selector);
        _cancel(id);
    }

    function test_cancel_twiceReverts() public {
        uint256 id = _create(true);
        vm.warp(start + 100);
        _cancel(id);

        vm.expectRevert(IVestingManager.NotActive.selector);
        _cancel(id);
    }

    function test_cancel_completedAgreementReverts() public {
        uint256 id = _create(true);
        vm.warp(end);
        _claim(id); // Completed

        vm.expectRevert(IVestingManager.NotActive.selector);
        _cancel(id);
    }

    function test_cancel_nonexistentIdReverts() public {
        vm.expectRevert(IVestingManager.AgreementNotFound.selector);
        _cancel(42);
    }

    // =========================================================== 5. Redondeo (bordes)

    function test_rounding_smallAmountNeverPaysMoreThanDeposited() public {
        // 7 unidades en 3 segundos: 2, 4 y 7 (redondea hacia abajo)
        uint256 id = _createFull(7, start, start + 3, true);

        vm.warp(start + 1);
        assertEq(vesting.vestedAmount(id), 2);
        vm.warp(start + 2);
        assertEq(vesting.vestedAmount(id), 4);
        vm.warp(start + 3);
        assertEq(vesting.vestedAmount(id), 7);

        _claim(id);
        assertEq(token.balanceOf(beneficiary), 7);
        assertEq(token.balanceOf(address(vesting)), 0);
    }

    function test_rounding_oneWeiOverLongPeriodIsZeroUntilEnd() public {
        uint256 id = _createFull(1, start, start + 365 days, true);

        vm.warp(start + 365 days - 1);
        assertEq(vesting.vestedAmount(id), 0, "1 wei no devenga antes del final");
        vm.expectRevert(IVestingManager.NothingToClaim.selector);
        _claim(id);

        vm.warp(start + 365 days);
        _claim(id);
        assertEq(token.balanceOf(beneficiary), 1);
    }

    function test_rounding_cancelNeverCreatesOrLosesTokens() public {
        uint256 id = _createFull(10, start, start + 3, true);
        uint256 payerBefore = token.balanceOf(payer);
        vm.warp(start + 1); // devengado = 3 (10*1/3), no devengado = 7
        _cancel(id);

        assertEq(token.balanceOf(payer), payerBefore + 7);
        assertEq(vesting.claimableAmount(id), 3);
        assertEq(token.balanceOf(address(vesting)), 3);
    }

    function test_rounding_hugeAmountDoesNotOverflow() public {
        uint256 big = type(uint128).max;
        token.mint(payer, big);
        uint256 id = _createFull(big, start, end, true);

        vm.warp(start + 500);
        assertEq(vesting.vestedAmount(id), Math.mulDiv(big, 500, DURATION));
        vm.warp(end);
        assertEq(vesting.vestedAmount(id), big);
    }

    // ================================================================ 6. Fuzzing

    function testFuzz_vestedIsBoundedAndMonotonic(uint96 amount, uint32 duration, uint32 t1, uint32 t2) public {
        amount = uint96(bound(amount, 1, 1e24));
        duration = uint32(bound(duration, 1, 5 * 365 days));
        t1 = uint32(bound(t1, 0, 6 * 365 days));
        t2 = uint32(bound(t2, t1, 6 * 365 days));

        token.mint(payer, amount);
        uint48 s = uint48(block.timestamp + 10);
        uint256 id = _createFull(amount, s, s + duration, true);

        vm.warp(uint256(s) + t1);
        uint256 v1 = vesting.vestedAmount(id);
        vm.warp(uint256(s) + t2);
        uint256 v2 = vesting.vestedAmount(id);

        assertLe(v1, amount, "nunca devenga mas que el total");
        assertLe(v1, v2, "el devengado nunca baja");
        assertLe(v2, amount);
        if (t2 >= duration) assertEq(v2, amount, "al final devenga el total");
    }

    function testFuzz_manyPartialClaimsNeverExceedDeposit(uint96 amount, uint32 duration, uint8 steps) public {
        amount = uint96(bound(amount, 1, 1e12));
        duration = uint32(bound(duration, 1, 3 * 365 days));
        steps = uint8(bound(steps, 1, 40));

        token.mint(payer, amount);
        uint48 s = uint48(block.timestamp + 1);
        uint256 id = _createFull(amount, s, s + duration, true);

        uint256 stepLength = uint256(duration) / steps + 1;
        vm.warp(s);
        for (uint256 i = 0; i < steps; i++) {
            vm.warp(block.timestamp + stepLength);
            if (vesting.claimableAmount(id) > 0) _claim(id);
            assertLe(token.balanceOf(beneficiary), amount, "nunca cobra mas de lo depositado");
        }

        vm.warp(uint256(s) + duration);
        if (vesting.claimableAmount(id) > 0) _claim(id);

        assertEq(token.balanceOf(beneficiary), amount, "al final cobra exactamente el total");
        assertEq(token.balanceOf(address(vesting)), 0, "no queda polvo en el contrato");
        assertEq(uint8(vesting.getAgreement(id).status), uint8(IVestingManager.Status.Completed));
    }

    function testFuzz_cancelSplitsExactlyTheDeposit(uint96 amount, uint32 duration, uint32 elapsed) public {
        amount = uint96(bound(amount, 1, 1e24));
        duration = uint32(bound(duration, 2, 3 * 365 days));
        elapsed = uint32(bound(elapsed, 0, duration - 1));

        token.mint(payer, amount);
        uint48 s = uint48(block.timestamp + 1);
        uint256 id = _createFull(amount, s, s + duration, true);
        uint256 payerBefore = token.balanceOf(payer);

        vm.warp(uint256(s) + elapsed);
        _cancel(id);

        uint256 refunded = token.balanceOf(payer) - payerBefore;
        uint256 owed = vesting.claimableAmount(id);
        assertEq(refunded + owed, amount, "pagador + beneficiario suman exactamente el deposito");
        assertEq(token.balanceOf(address(vesting)), owed);
    }

    // ============================================================ 7. getAgreements (lote)

    function test_getAgreements_returnsRequestedAgreementsInOrder() public {
        uint256 id1 = _create(true);
        uint256 id2 = _createFull(5e6, start, end, false);

        uint256[] memory ids = new uint256[](2);
        ids[0] = id2;
        ids[1] = id1;
        IVestingManager.Agreement[] memory list = vesting.getAgreements(ids);

        assertEq(list.length, 2);
        assertEq(list[0].totalAmount, 5e6);
        assertFalse(list[0].revocable);
        assertEq(list[1].totalAmount, AMOUNT);
        assertTrue(list[1].revocable);
    }

    function test_getAgreements_emptyListReturnsEmpty() public view {
        uint256[] memory ids = new uint256[](0);
        assertEq(vesting.getAgreements(ids).length, 0);
    }

    function test_getAgreements_nonexistentIdReverts() public {
        uint256 id = _create(true);
        uint256[] memory ids = new uint256[](2);
        ids[0] = id;
        ids[1] = 999;

        vm.expectRevert(IVestingManager.AgreementNotFound.selector);
        vesting.getAgreements(ids);
    }

    // ================================================== 8. Reentrancy / token malicioso

    /// Token malicioso con saldo propio y aprobacion al contrato, para que pueda actuar como pagador.
    function _evilSetup() internal returns (ReentrantToken evil) {
        evil = new ReentrantToken();
        evil.mint(address(evil), 10 * AMOUNT);
        evil.exec(address(evil), abi.encodeCall(evil.approve, (address(vesting), type(uint256).max)));
    }

    function _evilCreate(ReentrantToken evil, address beneficiary_) internal returns (uint256) {
        bytes memory ret = evil.exec(
            address(vesting),
            abi.encodeCall(vesting.createAgreement, (address(evil), beneficiary_, AMOUNT, start, end, true))
        );
        return abi.decode(ret, (uint256));
    }

    function test_reentrancy_claimCannotBeReentered() public {
        ReentrantToken evil = _evilSetup();
        // beneficiario = el token malicioso: asi la reentrada pasaria el chequeo NotBeneficiary
        uint256 id = _evilCreate(evil, address(evil));

        vm.warp(start + 500);
        evil.arm(address(vesting), abi.encodeCall(vesting.claim, (id)));
        uint256 evilBefore = evil.balanceOf(address(evil));
        evil.exec(address(vesting), abi.encodeCall(vesting.claim, (id)));

        assertTrue(evil.reentered(), "el token intento reentrar");
        assertFalse(evil.reentrySucceeded(), "la reentrada fallo");
        assertEq(
            bytes4(evil.reentryError()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector,
            "bloqueada por nonReentrant"
        );
        assertEq(evil.balanceOf(address(evil)) - evilBefore, 500e6, "cobro una sola vez");
        assertEq(vesting.getAgreement(id).claimedAmount, 500e6);
    }

    function test_reentrancy_cancelCannotBeReentered() public {
        ReentrantToken evil = _evilSetup();
        // pagador = el token malicioso: la reentrada pasaria el chequeo NotPayer
        uint256 id = _evilCreate(evil, beneficiary);

        vm.warp(start + 250);
        evil.arm(address(vesting), abi.encodeCall(vesting.cancel, (id)));
        uint256 evilBefore = evil.balanceOf(address(evil));
        evil.exec(address(vesting), abi.encodeCall(vesting.cancel, (id)));

        assertTrue(evil.reentered());
        assertFalse(evil.reentrySucceeded());
        assertEq(bytes4(evil.reentryError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(evil.balanceOf(address(evil)) - evilBefore, 750e6, "recibio el reembolso una sola vez");
        assertEq(uint8(vesting.getAgreement(id).status), uint8(IVestingManager.Status.Cancelled));
    }

    function test_reentrancy_cancelCannotReenterClaim() public {
        ReentrantToken evil = _evilSetup();
        // pagador y beneficiario son el token malicioso: durante el reembolso intenta reclamar
        uint256 id = _evilCreate(evil, address(evil));

        vm.warp(start + 250);
        evil.arm(address(vesting), abi.encodeCall(vesting.claim, (id)));
        evil.exec(address(vesting), abi.encodeCall(vesting.cancel, (id)));

        assertTrue(evil.reentered());
        assertFalse(evil.reentrySucceeded());
        assertEq(bytes4(evil.reentryError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(vesting.getAgreement(id).claimedAmount, 0, "no logro reclamar durante el reembolso");
    }

    function test_reentrancy_createCannotBeReentered() public {
        ReentrantToken evil = _evilSetup();
        bytes memory attack =
            abi.encodeCall(vesting.createAgreement, (address(evil), beneficiary, AMOUNT, start, end, true));
        evil.arm(address(vesting), attack);

        evil.exec(address(vesting), attack);

        assertTrue(evil.reentered());
        assertFalse(evil.reentrySucceeded());
        assertEq(bytes4(evil.reentryError()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(vesting.getAgreementsByBeneficiary(beneficiary).length, 1, "se creo un solo acuerdo");
    }

    function test_reentrancy_stateIsUpdatedBeforeTransfer() public {
        // Con un token honesto: tras reclamar, claimedAmount ya refleja el pago (checks-effects-interactions).
        uint256 id = _create(true);
        vm.warp(start + 500);
        _claim(id);
        assertEq(vesting.getAgreement(id).claimedAmount, token.balanceOf(beneficiary));
    }
}
