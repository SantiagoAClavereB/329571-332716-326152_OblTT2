// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VestingManager} from "../src/VestingManager.sol";
import {IVestingManager} from "../src/IVestingManager.sol";
import {MockToken} from "../src/MockToken.sol";

/// Desafio opcional A: cliff. Antes del cliff no se puede reclamar nada; desde el cliff se respeta el
/// vesting lineal calculado desde startTime.
contract VestingCliffTest is Test {
    VestingManager internal vesting;
    MockToken internal token;

    address internal payer = makeAddr("payer");
    address internal beneficiary = makeAddr("beneficiary");

    uint256 internal constant AMOUNT = 1_000e6;
    uint48 internal start;
    uint48 internal cliff; // start + 300
    uint48 internal end; // start + 1000

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockToken("Test USD", "tUSD", 6);
        vesting = new VestingManager();

        token.mint(payer, 10 * AMOUNT);
        vm.prank(payer);
        token.approve(address(vesting), type(uint256).max);

        start = uint48(block.timestamp + 10);
        cliff = start + 300;
        end = start + 1000;
    }

    function _createWithCliff(bool revocable) internal returns (uint256 id) {
        vm.prank(payer);
        id = vesting.createAgreementWithCliff(address(token), beneficiary, AMOUNT, start, cliff, end, revocable);
    }

    function _claim(uint256 id) internal {
        vm.prank(beneficiary);
        vesting.claim(id);
    }

    // ------------------------------------------------------------------ creacion

    function test_cliff_createStoresCliffAndEmitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit IVestingManager.AgreementCreated(1, payer, beneficiary, address(token), AMOUNT, start, end, true);
        vm.expectEmit(true, false, false, true);
        emit IVestingManager.CliffConfigured(1, cliff);
        uint256 id = _createWithCliff(true);

        assertEq(vesting.cliffOf(id), cliff);
        assertEq(token.balanceOf(address(vesting)), AMOUNT);
    }

    function test_cliff_agreementWithoutCliffReportsZero() public {
        vm.prank(payer);
        uint256 id = vesting.createAgreement(address(token), beneficiary, AMOUNT, start, end, true);
        assertEq(vesting.cliffOf(id), 0);
    }

    function test_cliff_cliffOfNonexistentReverts() public {
        vm.expectRevert(IVestingManager.AgreementNotFound.selector);
        vesting.cliffOf(77);
    }

    function test_cliff_revertsWhenBeforeStart() public {
        vm.prank(payer);
        vm.expectRevert(IVestingManager.InvalidCliff.selector);
        vesting.createAgreementWithCliff(address(token), beneficiary, AMOUNT, start, start - 1, end, true);
    }

    function test_cliff_revertsWhenAfterEnd() public {
        vm.prank(payer);
        vm.expectRevert(IVestingManager.InvalidCliff.selector);
        vesting.createAgreementWithCliff(address(token), beneficiary, AMOUNT, start, end + 1, end, true);
    }

    function test_cliff_zeroCliffIsRejectedUseCreateAgreementInstead() public {
        vm.prank(payer);
        vm.expectRevert(IVestingManager.InvalidCliff.selector);
        vesting.createAgreementWithCliff(address(token), beneficiary, AMOUNT, start, 0, end, true);
    }

    function test_cliff_keepsTheCommonValidations() public {
        vm.startPrank(payer);
        vm.expectRevert(IVestingManager.ZeroAmount.selector);
        vesting.createAgreementWithCliff(address(token), beneficiary, 0, start, cliff, end, true);

        vm.expectRevert(IVestingManager.InvalidBeneficiary.selector);
        vesting.createAgreementWithCliff(address(token), address(0), AMOUNT, start, cliff, end, true);

        vm.expectRevert(IVestingManager.InvalidTimeRange.selector);
        vesting.createAgreementWithCliff(address(token), beneficiary, AMOUNT, start, cliff, start, true);
        vm.stopPrank();
    }

    function test_cliff_cliffEqualToStartOrEndIsAllowed() public {
        vm.startPrank(payer);
        uint256 a = vesting.createAgreementWithCliff(address(token), beneficiary, AMOUNT, start, start, end, true);
        uint256 b = vesting.createAgreementWithCliff(address(token), beneficiary, AMOUNT, start, end, end, true);
        vm.stopPrank();
        assertEq(vesting.cliffOf(a), start);
        assertEq(vesting.cliffOf(b), end);
    }

    // ------------------------------------------------------------------ devengado

    function test_cliff_nothingVestedBeforeCliff() public {
        uint256 id = _createWithCliff(true);

        vm.warp(cliff - 1);
        assertEq(vesting.vestedAmount(id), 0, "un segundo antes del cliff");
        assertEq(vesting.claimableAmount(id), 0);

        vm.expectRevert(IVestingManager.NothingToClaim.selector);
        _claim(id);
    }

    function test_cliff_exactlyAtCliffVestsTheLinearAmountSinceStart() public {
        uint256 id = _createWithCliff(true);
        vm.warp(cliff);
        // 300 s de 1000 s desde el inicio -> 300 tokens, no 0
        assertEq(vesting.vestedAmount(id), 300e6);
        _claim(id);
        assertEq(token.balanceOf(beneficiary), 300e6);
    }

    function test_cliff_afterCliffFollowsLinearSchemeAndEndsAtTotal() public {
        uint256 id = _createWithCliff(true);

        vm.warp(start + 600);
        assertEq(vesting.vestedAmount(id), 600e6);

        vm.warp(end);
        assertEq(vesting.vestedAmount(id), AMOUNT);
        _claim(id);
        assertEq(token.balanceOf(beneficiary), AMOUNT);
        assertEq(uint8(vesting.getAgreement(id).status), uint8(IVestingManager.Status.Completed));
    }

    function test_cliff_atEndCliffMeansAllOrNothing() public {
        vm.prank(payer);
        uint256 id = vesting.createAgreementWithCliff(address(token), beneficiary, AMOUNT, start, end, end, true);

        vm.warp(end - 1);
        assertEq(vesting.vestedAmount(id), 0);
        vm.warp(end);
        assertEq(vesting.vestedAmount(id), AMOUNT);
    }

    function test_cliff_getAgreementsShowsZeroBeforeCliff() public {
        uint256 id = _createWithCliff(true);
        vm.warp(start + 100);

        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        IVestingManager.AgreementSummary memory s = vesting.getAgreements(ids)[0];
        assertEq(s.vested, 0);
        assertEq(s.claimable, 0);
    }

    // ------------------------------------------------------------------ cancelacion

    function test_cliff_cancelBeforeCliffRefundsEverything() public {
        uint256 id = _createWithCliff(true);
        uint256 payerBefore = token.balanceOf(payer);

        vm.warp(start + 200); // antes del cliff, aunque ya paso el inicio
        vm.prank(payer);
        vesting.cancel(id);

        assertEq(token.balanceOf(payer), payerBefore + AMOUNT, "el beneficiario no habia llegado al cliff");
        assertEq(vesting.getAgreement(id).vestedAtCancel, 0);

        vm.warp(end + 1);
        vm.expectRevert(IVestingManager.NothingToClaim.selector);
        _claim(id);
    }

    function test_cliff_cancelAfterCliffKeepsAccruedForBeneficiary() public {
        uint256 id = _createWithCliff(true);
        uint256 payerBefore = token.balanceOf(payer);

        vm.warp(start + 500);
        vm.prank(payer);
        vesting.cancel(id);

        assertEq(token.balanceOf(payer), payerBefore + 500e6);
        assertEq(vesting.claimableAmount(id), 500e6);
        _claim(id);
        assertEq(token.balanceOf(beneficiary), 500e6);
        assertEq(token.balanceOf(address(vesting)), 0);
    }

    // ------------------------------------------------------------------ fuzzing

    function testFuzz_cliff_neverVestsBeforeCliffAndNeverExceedsTotal(uint32 cliffOffset, uint32 elapsed) public {
        cliffOffset = uint32(bound(cliffOffset, 0, 1000));
        elapsed = uint32(bound(elapsed, 0, 2000));

        vm.prank(payer);
        uint256 id = vesting.createAgreementWithCliff(
            address(token), beneficiary, AMOUNT, start, start + cliffOffset, end, true
        );

        vm.warp(uint256(start) + elapsed);
        uint256 vested = vesting.vestedAmount(id);

        if (elapsed < cliffOffset) assertEq(vested, 0, "nada antes del cliff");
        assertLe(vested, AMOUNT, "nunca mas que el total");
        if (elapsed >= 1000) assertEq(vested, AMOUNT);
    }
}
