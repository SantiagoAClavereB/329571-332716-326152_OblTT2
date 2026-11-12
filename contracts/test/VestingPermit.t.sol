// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {VestingManager} from "../src/VestingManager.sol";
import {IVestingManager} from "../src/IVestingManager.sol";
import {MockToken} from "../src/MockToken.sol";
import {MockPermitToken} from "../src/MockPermitToken.sol";

/// Desafio opcional E: Permit (EIP-2612). El pagador crea el acuerdo en UNA transaccion, sin approve previo.
contract VestingPermitTest is Test {
    VestingManager internal vesting;
    MockPermitToken internal token;

    address internal owner;
    uint256 internal ownerPk;
    address internal beneficiary = makeAddr("beneficiary");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant AMOUNT = 1_000e6;
    uint48 internal start;
    uint48 internal end;
    uint256 internal deadline;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockPermitToken("Permit USD", "pUSD", 6);
        vesting = new VestingManager();
        (owner, ownerPk) = makeAddrAndKey("owner");
        token.mint(owner, 10 * AMOUNT); // tiene saldo pero NO hizo approve

        start = uint48(block.timestamp + 10);
        end = start + 1000;
        deadline = block.timestamp + 1 hours;
    }

    /// Firma un permit de `value` a favor del VestingManager con la clave `pk`.
    function _sign(uint256 pk, address tokenOwner, uint256 value, uint256 dl)
        internal
        view
        returns (IVestingManager.PermitSignature memory sig)
    {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, tokenOwner, address(vesting), value, token.nonces(tokenOwner), dl));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = IVestingManager.PermitSignature({deadline: dl, v: v, r: r, s: s});
    }

    function _createWithPermit(IVestingManager.PermitSignature memory sig, address caller) internal returns (uint256) {
        vm.prank(caller);
        return vesting.createAgreementWithPermit(address(token), beneficiary, AMOUNT, start, end, true, sig);
    }

    // ------------------------------------------------------------------ camino feliz

    function test_permit_createsAgreementInOneTransactionWithoutApprove() public {
        assertEq(token.allowance(owner, address(vesting)), 0, "parte sin approve");

        uint256 id = _createWithPermit(_sign(ownerPk, owner, AMOUNT, deadline), owner);

        IVestingManager.Agreement memory a = vesting.getAgreement(id);
        assertEq(a.payer, owner);
        assertEq(a.beneficiary, beneficiary);
        assertEq(a.totalAmount, AMOUNT);
        assertEq(token.balanceOf(address(vesting)), AMOUNT);
        assertEq(token.balanceOf(owner), 9 * AMOUNT);
    }

    function test_permit_allowanceIsFullyConsumedAndNonceAdvances() public {
        assertEq(token.nonces(owner), 0);
        _createWithPermit(_sign(ownerPk, owner, AMOUNT, deadline), owner);

        assertEq(token.allowance(owner, address(vesting)), 0, "no deja una aprobacion abierta");
        assertEq(token.nonces(owner), 1);
    }

    function test_permit_emitsAgreementCreated() public {
        IVestingManager.PermitSignature memory sig = _sign(ownerPk, owner, AMOUNT, deadline);
        vm.expectEmit(true, true, true, true);
        emit IVestingManager.AgreementCreated(1, owner, beneficiary, address(token), AMOUNT, start, end, true);
        _createWithPermit(sig, owner);
    }

    function test_permit_agreementBehavesLikeANormalOne() public {
        uint256 id = _createWithPermit(_sign(ownerPk, owner, AMOUNT, deadline), owner);

        vm.warp(start + 500);
        vm.prank(beneficiary);
        vesting.claim(id);
        assertEq(token.balanceOf(beneficiary), 500e6);

        vm.prank(owner);
        vesting.cancel(id);
        assertEq(uint8(vesting.getAgreement(id).status), uint8(IVestingManager.Status.Cancelled));
    }

    // ------------------------------------------------------------------ firmas invalidas

    function test_permit_expiredDeadlineFailsWithInsufficientAllowance() public {
        IVestingManager.PermitSignature memory sig = _sign(ownerPk, owner, AMOUNT, block.timestamp + 10);
        vm.warp(block.timestamp + 11);

        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vesting), 0, AMOUNT)
        );
        _createWithPermit(sig, owner);
        assertEq(token.balanceOf(address(vesting)), 0);
    }

    function test_permit_signatureFromAnotherKeyFails() public {
        (, uint256 otherPk) = makeAddrAndKey("other");
        IVestingManager.PermitSignature memory sig = _sign(otherPk, owner, AMOUNT, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vesting), 0, AMOUNT)
        );
        _createWithPermit(sig, owner);
    }

    function test_permit_signatureForADifferentAmountFails() public {
        IVestingManager.PermitSignature memory sig = _sign(ownerPk, owner, AMOUNT - 1, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vesting), 0, AMOUNT)
        );
        _createWithPermit(sig, owner);
    }

    function test_permit_replayedSignatureFails() public {
        IVestingManager.PermitSignature memory sig = _sign(ownerPk, owner, AMOUNT, deadline);
        _createWithPermit(sig, owner);

        // la misma firma ya consumio su nonce y la allowance quedo en 0
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vesting), 0, AMOUNT)
        );
        _createWithPermit(sig, owner);
    }

    function test_permit_someoneElseCannotUseTheOwnersSignature() public {
        token.mint(attacker, AMOUNT);
        IVestingManager.PermitSignature memory sig = _sign(ownerPk, owner, AMOUNT, deadline);

        // el atacante manda la firma del dueno: permit se evalua con owner = msg.sender (el atacante) y falla
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vesting), 0, AMOUNT)
        );
        _createWithPermit(sig, attacker);
        assertEq(token.balanceOf(owner), 10 * AMOUNT, "no se toco el saldo del dueno");
    }

    // ------------------------------------------------------------------ front-running y fallback

    function test_permit_frontRunningThePermitDoesNotBlockTheCreation() public {
        IVestingManager.PermitSignature memory sig = _sign(ownerPk, owner, AMOUNT, deadline);

        // un tercero ve la firma en el mempool y ejecuta permit antes
        vm.prank(attacker);
        token.permit(owner, address(vesting), AMOUNT, sig.deadline, sig.v, sig.r, sig.s);

        // la llamada del dueno igual funciona: el permit fallido se ignora y la allowance ya existe
        uint256 id = _createWithPermit(sig, owner);
        assertEq(vesting.getAgreement(id).payer, owner);
        assertEq(token.balanceOf(address(vesting)), AMOUNT);
    }

    function test_permit_fallsBackToExistingAllowance() public {
        vm.prank(owner);
        token.approve(address(vesting), AMOUNT);

        // firma basura: no importa, ya hay allowance
        IVestingManager.PermitSignature memory junk =
            IVestingManager.PermitSignature({deadline: 0, v: 27, r: bytes32(uint256(1)), s: bytes32(uint256(2))});
        uint256 id = _createWithPermit(junk, owner);
        assertEq(vesting.getAgreement(id).totalAmount, AMOUNT);
    }

    function test_permit_tokenWithoutPermitSupportWorksWithPriorApprove() public {
        MockToken plain = new MockToken("Plain", "PLN", 6);
        plain.mint(owner, AMOUNT);
        vm.startPrank(owner);
        plain.approve(address(vesting), AMOUNT);

        IVestingManager.PermitSignature memory junk =
            IVestingManager.PermitSignature({deadline: 0, v: 0, r: bytes32(0), s: bytes32(0)});
        uint256 id = vesting.createAgreementWithPermit(address(plain), beneficiary, AMOUNT, start, end, true, junk);
        vm.stopPrank();
        assertEq(vesting.getAgreement(id).token, address(plain));
    }

    function test_permit_tokenWithoutPermitSupportAndNoApproveReverts() public {
        MockToken plain = new MockToken("Plain", "PLN", 6);
        plain.mint(owner, AMOUNT);

        IVestingManager.PermitSignature memory junk =
            IVestingManager.PermitSignature({deadline: 0, v: 0, r: bytes32(0), s: bytes32(0)});
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vesting), 0, AMOUNT)
        );
        vesting.createAgreementWithPermit(address(plain), beneficiary, AMOUNT, start, end, true, junk);
    }

    // ------------------------------------------------------------------ validaciones previas

    function test_permit_commonValidationsRunBeforeAnyPermit() public {
        IVestingManager.PermitSignature memory sig = _sign(ownerPk, owner, AMOUNT, deadline);

        vm.startPrank(owner);
        vm.expectRevert(IVestingManager.ZeroAddress.selector);
        vesting.createAgreementWithPermit(address(0), beneficiary, AMOUNT, start, end, true, sig);

        vm.expectRevert(IVestingManager.ZeroAmount.selector);
        vesting.createAgreementWithPermit(address(token), beneficiary, 0, start, end, true, sig);

        vm.expectRevert(IVestingManager.InvalidBeneficiary.selector);
        vesting.createAgreementWithPermit(address(token), address(0), AMOUNT, start, end, true, sig);

        vm.expectRevert(IVestingManager.InvalidTimeRange.selector);
        vesting.createAgreementWithPermit(address(token), beneficiary, AMOUNT, end, start, true, sig);
        vm.stopPrank();

        // como fallaron antes de llamar a permit, la firma sigue sin usarse
        assertEq(token.nonces(owner), 0);
    }
}
