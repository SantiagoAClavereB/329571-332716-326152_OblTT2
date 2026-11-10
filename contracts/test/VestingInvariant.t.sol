// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {VestingManager} from "../src/VestingManager.sol";
import {IVestingManager} from "../src/IVestingManager.sol";
import {MockToken} from "../src/MockToken.sol";

/// @notice Ejecuta secuencias aleatorias de crear, reclamar, cancelar y avanzar el tiempo.
contract VestingHandler is Test {
    VestingManager public immutable vesting;
    MockToken public immutable token;

    address[3] public actors;
    uint256[] public ids;

    constructor(VestingManager vesting_, MockToken token_) {
        vesting = vesting_;
        token = token_;
        actors = [makeAddr("actor0"), makeAddr("actor1"), makeAddr("actor2")];
        for (uint256 i = 0; i < actors.length; i++) {
            token.mint(actors[i], 1e30);
            vm.prank(actors[i]);
            token.approve(address(vesting), type(uint256).max);
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function create(
        uint256 payerSeed,
        uint256 beneficiarySeed,
        uint256 amount,
        uint256 startOffset,
        uint256 duration,
        bool revocable
    ) external {
        amount = bound(amount, 1, 1e12);
        duration = bound(duration, 1, 365 days);
        startOffset = bound(startOffset, 0, 30 days);
        uint48 s = uint48(block.timestamp + startOffset);

        vm.prank(actors[payerSeed % actors.length]);
        uint256 id = vesting.createAgreement(
            address(token), actors[beneficiarySeed % actors.length], amount, s, s + uint48(duration), revocable
        );
        ids.push(id);
    }

    function claim(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address who = vesting.getAgreement(id).beneficiary;
        vm.prank(who);
        try vesting.claim(id) {} catch {}
    }

    function cancel(uint256 idSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address who = vesting.getAgreement(id).payer;
        vm.prank(who);
        try vesting.cancel(id) {} catch {}
    }

    function warp(uint256 secondsForward) external {
        vm.warp(block.timestamp + bound(secondsForward, 0, 90 days));
    }
}

contract VestingInvariantTest is StdInvariant, Test {
    VestingManager internal vesting;
    MockToken internal token;
    VestingHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockToken("Test USD", "tUSD", 6);
        vesting = new VestingManager();
        handler = new VestingHandler(vesting, token);
        targetContract(address(handler));
    }

    /// El balance del contrato siempre cubre lo que todavia se debe pagar:
    /// Active -> lo no reclamado del total, Cancelled -> lo devengado y no reclamado, Completed -> 0.
    function invariant_contractBalanceCoversPendingAmounts() public view {
        uint256 pending;
        for (uint256 i = 0; i < handler.idsLength(); i++) {
            IVestingManager.Agreement memory a = vesting.getAgreement(handler.ids(i));
            if (a.status == IVestingManager.Status.Active) {
                pending += a.totalAmount - a.claimedAmount;
            } else if (a.status == IVestingManager.Status.Cancelled) {
                pending += a.vestedAtCancel - a.claimedAmount;
            }
        }
        assertGe(token.balanceOf(address(vesting)), pending, "el contrato quedo sub-fondeado");
    }

    /// Para cada acuerdo: reclamado <= devengado <= total.
    function invariant_claimedNeverExceedsVestedNorTotal() public view {
        for (uint256 i = 0; i < handler.idsLength(); i++) {
            uint256 id = handler.ids(i);
            IVestingManager.Agreement memory a = vesting.getAgreement(id);
            assertLe(a.claimedAmount, vesting.vestedAmount(id), "reclamo mas de lo devengado");
            assertLe(vesting.vestedAmount(id), a.totalAmount, "devengo mas que el total");
        }
    }

    /// Un acuerdo Completed tiene todo reclamado y no deja nada pendiente.
    function invariant_completedMeansFullyClaimed() public view {
        for (uint256 i = 0; i < handler.idsLength(); i++) {
            IVestingManager.Agreement memory a = vesting.getAgreement(handler.ids(i));
            if (a.status == IVestingManager.Status.Completed) {
                assertEq(a.claimedAmount, a.totalAmount);
            }
        }
    }
}
