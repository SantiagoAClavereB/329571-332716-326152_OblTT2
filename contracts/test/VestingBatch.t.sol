// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {VestingManager} from "../src/VestingManager.sol";
import {IVestingManager} from "../src/IVestingManager.sol";
import {MockToken} from "../src/MockToken.sol";
import {FeeToken} from "./mocks/FeeToken.sol";

/// Desafio opcional C: batch payroll. Varios acuerdos en una sola operacion y una sola transferencia.
contract VestingBatchTest is Test {
    VestingManager internal vesting;
    MockToken internal token;

    address internal payer = makeAddr("payer");
    uint48 internal start;
    uint48 internal end;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockToken("Test USD", "tUSD", 6);
        vesting = new VestingManager();

        token.mint(payer, 1_000_000e6);
        vm.prank(payer);
        token.approve(address(vesting), type(uint256).max);

        start = uint48(block.timestamp + 10);
        end = start + 1000;
    }

    function _people(uint256 n) internal returns (address[] memory people, uint256[] memory amounts) {
        people = new address[](n);
        amounts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            people[i] = makeAddr(string.concat("employee", vm.toString(i)));
            amounts[i] = (i + 1) * 100e6; // 100, 200, 300 ...
        }
    }

    // ------------------------------------------------------------------ camino feliz

    function test_batch_createsOneAgreementPerBeneficiary() public {
        (address[] memory people, uint256[] memory amounts) = _people(3);

        vm.prank(payer);
        uint256[] memory ids = vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);

        assertEq(ids.length, 3);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
        assertEq(ids[2], 3);
        for (uint256 i = 0; i < 3; i++) {
            IVestingManager.Agreement memory a = vesting.getAgreement(ids[i]);
            assertEq(a.payer, payer);
            assertEq(a.beneficiary, people[i]);
            assertEq(a.totalAmount, amounts[i]);
            assertEq(a.token, address(token));
            assertEq(a.startTime, start);
            assertEq(a.endTime, end);
            assertTrue(a.revocable);
            assertEq(vesting.getAgreementsByBeneficiary(people[i]).length, 1);
        }
        assertEq(vesting.getAgreementsByPayer(payer).length, 3);
    }

    function test_batch_pullsTheSumInOneTransfer() public {
        (address[] memory people, uint256[] memory amounts) = _people(4); // 100+200+300+400 = 1000
        uint256 payerBefore = token.balanceOf(payer);

        vm.prank(payer);
        vesting.createAgreementsBatch(address(token), people, amounts, start, end, false);

        assertEq(token.balanceOf(address(vesting)), 1_000e6);
        assertEq(token.balanceOf(payer), payerBefore - 1_000e6);
    }

    function test_batch_emitsOneCreatedEventPerAgreement() public {
        (address[] memory people, uint256[] memory amounts) = _people(2);

        vm.expectEmit(true, true, true, true);
        emit IVestingManager.AgreementCreated(1, payer, people[0], address(token), amounts[0], start, end, true);
        vm.expectEmit(true, true, true, true);
        emit IVestingManager.AgreementCreated(2, payer, people[1], address(token), amounts[1], start, end, true);

        vm.prank(payer);
        vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);
    }

    function test_batch_eachBeneficiaryCanClaimIndependently() public {
        (address[] memory people, uint256[] memory amounts) = _people(2);
        vm.prank(payer);
        uint256[] memory ids = vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);

        vm.warp(start + 500);
        vm.prank(people[0]);
        vesting.claim(ids[0]);
        vm.prank(people[1]);
        vesting.claim(ids[1]);

        assertEq(token.balanceOf(people[0]), 50e6);
        assertEq(token.balanceOf(people[1]), 100e6);

        // un beneficiario no puede reclamar el acuerdo de otro
        vm.prank(people[0]);
        vm.expectRevert(IVestingManager.NotBeneficiary.selector);
        vesting.claim(ids[1]);
    }

    function test_batch_agreementsCanBeCancelledIndividually() public {
        (address[] memory people, uint256[] memory amounts) = _people(2);
        vm.prank(payer);
        uint256[] memory ids = vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);

        vm.warp(start + 500);
        uint256 payerBefore = token.balanceOf(payer);
        vm.prank(payer);
        vesting.cancel(ids[1]); // el segundo: 200, devengado 100, devuelve 100

        assertEq(token.balanceOf(payer), payerBefore + 100e6);
        assertEq(uint8(vesting.getAgreement(ids[0]).status), uint8(IVestingManager.Status.Active));
        assertEq(uint8(vesting.getAgreement(ids[1]).status), uint8(IVestingManager.Status.Cancelled));
    }

    function test_batch_sameBeneficiaryTwiceIsAllowed() public {
        address[] memory people = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        people[0] = makeAddr("same");
        people[1] = people[0];
        amounts[0] = 10e6;
        amounts[1] = 20e6;

        vm.prank(payer);
        vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);
        assertEq(vesting.getAgreementsByBeneficiary(people[0]).length, 2);
    }

    // ------------------------------------------------------------------ rechazos (el lote es atomico)

    function test_batch_emptyReverts() public {
        address[] memory people = new address[](0);
        uint256[] memory amounts = new uint256[](0);
        vm.prank(payer);
        vm.expectRevert(IVestingManager.EmptyBatch.selector);
        vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);
    }

    function test_batch_lengthMismatchReverts() public {
        (address[] memory people,) = _people(3);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1e6;
        amounts[1] = 1e6;
        vm.prank(payer);
        vm.expectRevert(IVestingManager.LengthMismatch.selector);
        vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);
    }

    function test_batch_oneInvalidElementRevertsAllAndMovesNothing() public {
        (address[] memory people, uint256[] memory amounts) = _people(3);
        amounts[2] = 0; // el ultimo es invalido
        uint256 payerBefore = token.balanceOf(payer);

        vm.prank(payer);
        vm.expectRevert(IVestingManager.ZeroAmount.selector);
        vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);

        assertEq(token.balanceOf(payer), payerBefore);
        assertEq(token.balanceOf(address(vesting)), 0);
        assertEq(vesting.getAgreementsByPayer(payer).length, 0);
    }

    function test_batch_invalidBeneficiaryReverts() public {
        (address[] memory people, uint256[] memory amounts) = _people(3);
        people[1] = address(0);
        vm.prank(payer);
        vm.expectRevert(IVestingManager.InvalidBeneficiary.selector);
        vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);

        people[1] = address(vesting);
        vm.prank(payer);
        vm.expectRevert(IVestingManager.InvalidBeneficiary.selector);
        vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);
    }

    function test_batch_invalidTimesAndTokenRevert() public {
        (address[] memory people, uint256[] memory amounts) = _people(2);

        vm.startPrank(payer);
        vm.expectRevert(IVestingManager.InvalidTimeRange.selector);
        vesting.createAgreementsBatch(address(token), people, amounts, end, start, true);

        vm.expectRevert(IVestingManager.ZeroAddress.selector);
        vesting.createAgreementsBatch(address(0), people, amounts, start, end, true);
        vm.stopPrank();
    }

    function test_batch_revertsWhenAllowanceCoversOnlyPartOfTheSum() public {
        (address[] memory people, uint256[] memory amounts) = _people(3); // suma 600
        address spender = makeAddr("lowAllowance");
        token.mint(spender, 600e6);
        vm.startPrank(spender);
        token.approve(address(vesting), 599e6);

        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vesting), 599e6, 600e6)
        );
        vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);
        vm.stopPrank();
    }

    function test_batch_feeOnTransferTokenReverts() public {
        FeeToken feeToken = new FeeToken();
        feeToken.mint(payer, 1_000e6);
        vm.prank(payer);
        feeToken.approve(address(vesting), type(uint256).max);

        (address[] memory people, uint256[] memory amounts) = _people(2);
        vm.prank(payer);
        vm.expectRevert(IVestingManager.FeeOnTransferNotSupported.selector);
        vesting.createAgreementsBatch(address(feeToken), people, amounts, start, end, true);
    }

    // ------------------------------------------------------------------ gas

    /// Mide el gas de crear N acuerdos uno por uno contra hacerlo en un solo lote.
    /// Se usa un snapshot para que ambos casos partan del mismo estado.
    function test_batch_isCheaperThanIndividualCreations() public {
        uint256 n = 10;
        (address[] memory people, uint256[] memory amounts) = _people(n);

        uint256 snap = vm.snapshotState();

        vm.startPrank(payer);
        uint256 g = gasleft();
        for (uint256 i = 0; i < n; i++) {
            vesting.createAgreement(address(token), people[i], amounts[i], start, end, true);
        }
        uint256 individualGas = g - gasleft();
        vm.stopPrank();

        vm.revertToState(snap);

        vm.prank(payer);
        g = gasleft();
        vesting.createAgreementsBatch(address(token), people, amounts, start, end, true);
        uint256 batchGas = g - gasleft();

        console2.log("gas de 10 createAgreement:", individualGas);
        console2.log("gas de 1 createAgreementsBatch(10):", batchGas);
        console2.log("ahorro (%):", ((individualGas - batchGas) * 100) / individualGas);

        assertLt(batchGas, individualGas, "el lote tiene que salir mas barato");
    }
}
