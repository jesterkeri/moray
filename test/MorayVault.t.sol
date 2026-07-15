// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MorayVault} from "../src/MorayVault.sol";

/// @notice Behavioural + adversarial tests for MorayVault. Each security control
///         is tested for BOTH the happy path and the denied bad case.
contract MorayVaultTest is Test {
    MorayVault internal vault;

    uint64 internal constant MIN_DELAY = 60; // new-payee clearing floor
    uint64 internal constant CONFIG_DELAY = 120; // powerful config changes / unfreeze
    uint64 internal constant VETO_DELAY = 180; // inheritance veto window

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal heir = makeAddr("heir");
    address internal safe = makeAddr("safe");
    address internal recovery = makeAddr("recovery");

    function setUp() public {
        vm.warp(1_000_000); // non-trivial base time so lastActivity+period never underflows
        vault = new MorayVault(MIN_DELAY, CONFIG_DELAY, VETO_DELAY);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    // ------------------------------------------------------------------ //
    //                             Helpers                                 //
    // ------------------------------------------------------------------ //

    function _deposit(address u, uint256 amt) internal {
        vm.prank(u);
        vault.deposit{value: amt}();
    }

    function _setSafe(address u, address s) internal {
        vm.prank(u);
        vault.requestChange(MorayVault.ChangeKind.SetSafe, s, 0);
    }

    function _setRecovery(address u, address r) internal {
        vm.prank(u);
        vault.requestChange(MorayVault.ChangeKind.SetRecovery, r, 0);
    }

    function _setHeir(address u, address h) internal {
        vm.prank(u);
        vault.requestChange(MorayVault.ChangeKind.SetHeir, h, 0);
    }

    function _setInactivity(address u, uint64 period) internal {
        vm.prank(u);
        vault.requestChange(MorayVault.ChangeKind.SetInactivity, address(0), period);
    }

    function _unlockOf(uint256 id) internal view returns (uint64) {
        (,,, uint64 unlockTime,) = vault.transfers(id);
        return unlockTime;
    }

    function _statusOf(uint256 id) internal view returns (MorayVault.Status) {
        (,,,, MorayVault.Status s) = vault.transfers(id);
        return s;
    }

    // ------------------------------------------------------------------ //
    //                        Deposit / withdraw                           //
    // ------------------------------------------------------------------ //

    function test_DepositAndWithdraw() public {
        _deposit(alice, 1 ether);
        assertEq(vault.balanceOf(alice), 1 ether);

        uint256 walletBefore = alice.balance;
        vm.prank(alice);
        vault.withdraw(0.4 ether);
        assertEq(vault.balanceOf(alice), 0.6 ether);
        assertEq(alice.balance, walletBefore + 0.4 ether);
    }

    function test_WithdrawInsufficientReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("insufficient"));
        vault.withdraw(2 ether);
    }

    function test_WithdrawZeroReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("zero"));
        vault.withdraw(0);
    }

    // ------------------------------------------------------------------ //
    //                    Send & new-payee floor                           //
    // ------------------------------------------------------------------ //

    function test_NewPayeeFloorRaisesWindow() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.2 ether, 0); // asked for 0, forced to MIN_DELAY
        assertEq(_unlockOf(id), uint64(block.timestamp) + MIN_DELAY);
        assertEq(vault.balanceOf(alice), 0.8 ether);
    }

    function test_RequestedDelayHonoredAboveFloor() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.2 ether, 100); // 100 > 60, honored
        assertEq(_unlockOf(id), uint64(block.timestamp) + 100);
    }

    function test_ClearedPayeeCanSendInstant() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id0 = vault.send(bob, 0.2 ether, 0);
        vm.warp(block.timestamp + MIN_DELAY);
        vault.claim(id0); // sets cleared[alice][bob] = true
        assertTrue(vault.cleared(alice, bob));

        vm.prank(alice);
        uint256 id1 = vault.send(bob, 0.2 ether, 0); // cleared → no forced floor
        assertEq(_unlockOf(id1), uint64(block.timestamp)); // instant
    }

    function test_SendSelfReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("self"));
        vault.send(alice, 0.1 ether, 0);
    }

    function test_SendZeroToReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("zero to"));
        vault.send(address(0), 0.1 ether, 0);
    }

    function test_SendInsufficientReverts() public {
        _deposit(alice, 0.1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("insufficient"));
        vault.send(bob, 1 ether, 0);
    }

    function test_MaxActivePendingCap() public {
        _deposit(alice, 100 ether);
        for (uint256 i = 0; i < vault.MAX_ACTIVE_PENDING(); i++) {
            vm.prank(alice);
            vault.send(makeAddr(string(abi.encodePacked("payee", i))), 0.1 ether, 0);
        }
        assertEq(vault.activePendingCount(alice), vault.MAX_ACTIVE_PENDING());
        vm.prank(alice);
        vm.expectRevert(bytes("too many pending"));
        vault.send(bob, 0.1 ether, 0);
    }

    // ------------------------------------------------------------------ //
    //                        Recall (cancel)                              //
    // ------------------------------------------------------------------ //

    function test_CancelRefundsBeforeUnlock() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);
        assertEq(vault.balanceOf(alice), 0.7 ether);

        vm.prank(alice);
        vault.cancel(id);
        assertEq(vault.balanceOf(alice), 1 ether);
        assertEq(uint256(_statusOf(id)), uint256(MorayVault.Status.Cancelled));
        assertEq(vault.activePendingCount(alice), 0);
    }

    function test_CancelAfterWindowReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.prank(alice);
        vm.expectRevert(bytes("window closed"));
        vault.cancel(id);
    }

    function test_CancelByNonSenderReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);
        vm.prank(bob);
        vm.expectRevert(bytes("not sender"));
        vault.cancel(id);
    }

    // ------------------------------------------------------------------ //
    //                            Claim                                    //
    // ------------------------------------------------------------------ //

    function test_ClaimPaysAfterWindow() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);
        uint256 bobBefore = bob.balance;
        vm.warp(block.timestamp + MIN_DELAY);
        vault.claim(id);
        assertEq(bob.balance, bobBefore + 0.3 ether);
        assertEq(uint256(_statusOf(id)), uint256(MorayVault.Status.Claimed));
        assertTrue(vault.cleared(alice, bob));
        assertEq(vault.activePendingCount(alice), 0);
    }

    function test_ClaimBeforeWindowReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);
        vm.expectRevert(bytes("still clearing"));
        vault.claim(id);
    }

    function test_ClaimWhileSenderFrozenReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);
        vm.prank(alice);
        vault.panic();
        vm.warp(block.timestamp + MIN_DELAY);
        vm.expectRevert(bytes("sender frozen"));
        vault.claim(id);
    }

    // ------------------------------------------------------------------ //
    //                     Panic / freeze (protective)                     //
    // ------------------------------------------------------------------ //

    function test_PanicBlocksWithdrawAndSend() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vault.panic();

        vm.prank(alice);
        vm.expectRevert(bytes("frozen"));
        vault.withdraw(0.1 ether);

        vm.prank(alice);
        vm.expectRevert(bytes("frozen"));
        vault.send(bob, 0.1 ether, 0);
    }

    function test_RecoveryContactCanFreeze() public {
        _deposit(alice, 1 ether);
        _setRecovery(alice, recovery);

        vm.prank(recovery);
        vault.freeze(alice);

        vm.prank(alice);
        vm.expectRevert(bytes("frozen"));
        vault.withdraw(0.1 ether);
    }

    function test_NonRecoveryCannotFreeze() public {
        _deposit(alice, 1 ether);
        _setRecovery(alice, recovery);
        vm.prank(bob);
        vm.expectRevert(bytes("not recovery"));
        vault.freeze(alice);
    }

    function test_DoubleFreezeReverts() public {
        vm.prank(alice);
        vault.panic();
        vm.prank(alice);
        vm.expectRevert(bytes("already frozen"));
        vault.panic();
    }

    // ------------------------------------------------------------------ //
    //                     Unfreeze is timelocked                          //
    // ------------------------------------------------------------------ //

    function test_UnfreezeIsTimelocked() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vault.panic();

        // request unfreeze -> pending, NOT instant
        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.Unfreeze, address(0), 0);

        vm.prank(alice);
        vm.expectRevert(bytes("not matured"));
        vault.executeChange();

        vm.warp(block.timestamp + CONFIG_DELAY);
        vm.prank(alice);
        vault.executeChange();

        // now egress works again
        vm.prank(alice);
        vault.withdraw(0.1 ether);
        assertEq(vault.balanceOf(alice), 0.9 ether);
    }

    function test_UnfreezeWhenNotFrozenReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("not frozen"));
        vault.requestChange(MorayVault.ChangeKind.Unfreeze, address(0), 0);
    }

    // ------------------------------------------------------------------ //
    //                          Kill switch                                //
    // ------------------------------------------------------------------ //

    function test_KillSwitchSweepsBalanceAndPendingsToSafe() public {
        _deposit(alice, 1 ether);
        _setSafe(alice, safe);
        vm.prank(alice);
        vault.send(bob, 0.3 ether, 0); // 0.3 in flight, 0.7 in balance
        assertEq(vault.activePendingCount(alice), 1);

        uint256 safeBefore = safe.balance;
        uint256 vaultBefore = address(vault).balance;

        vm.prank(alice);
        vault.killSwitch(alice);

        assertEq(safe.balance, safeBefore + 1 ether); // balance + reclaimed pending
        assertEq(address(vault).balance, vaultBefore - 1 ether);
        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.activePendingCount(alice), 0);
        (,,,, MorayVault.Status s) = vault.transfers(0);
        assertEq(uint256(s), uint256(MorayVault.Status.Cancelled));
        // account stays frozen after sweep
        vm.prank(alice);
        vm.expectRevert(bytes("frozen"));
        vault.withdraw(1);
    }

    function test_RecoveryContactCanKillSwitchButOnlyToSafe() public {
        _deposit(alice, 1 ether);
        _setSafe(alice, safe);
        _setRecovery(alice, recovery);

        uint256 safeBefore = safe.balance;
        uint256 recoveryBefore = recovery.balance;

        vm.prank(recovery);
        vault.killSwitch(alice);

        assertEq(safe.balance, safeBefore + 1 ether); // funds go to owner's safe...
        assertEq(recovery.balance, recoveryBefore); // ...never to the recovery contact
    }

    function test_KillSwitchWithoutSafeReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("no safe address"));
        vault.killSwitch(alice);
    }

    function test_KillSwitchUnauthorizedReverts() public {
        _deposit(alice, 1 ether);
        _setSafe(alice, safe);
        vm.prank(bob);
        vm.expectRevert(bytes("not authorized"));
        vault.killSwitch(alice);
    }

    // ------------------------------------------------------------------ //
    //                    Timelocked config changes                        //
    // ------------------------------------------------------------------ //

    function test_ConfigInstantOnFirstSetThenTimelocked() public {
        // first set is instant
        _setSafe(alice, safe);
        (address s0,,,,,) = vault.accounts(alice);
        assertEq(s0, safe);

        // changing it is timelocked and does not apply immediately
        address safe2 = makeAddr("safe2");
        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.SetSafe, safe2, 0);
        (address s1,,,,,) = vault.accounts(alice);
        assertEq(s1, safe); // unchanged during delay

        vm.prank(alice);
        vm.expectRevert(bytes("not matured"));
        vault.executeChange();

        vm.warp(block.timestamp + CONFIG_DELAY);
        vm.prank(alice);
        vault.executeChange();
        (address s2,,,,,) = vault.accounts(alice);
        assertEq(s2, safe2);
    }

    function test_OwnerCanCancelPendingChange() public {
        _setSafe(alice, safe);
        address safe2 = makeAddr("safe2");
        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.SetSafe, safe2, 0);
        vm.prank(alice);
        vault.cancelChange();

        vm.warp(block.timestamp + CONFIG_DELAY);
        vm.prank(alice);
        vm.expectRevert(bytes("no change"));
        vault.executeChange();
        (address s,,,,,) = vault.accounts(alice);
        assertEq(s, safe); // still the original
    }

    function test_OnlyOnePendingChangeAtATime() public {
        _setSafe(alice, safe);
        address safe2 = makeAddr("safe2");
        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.SetSafe, safe2, 0);
        vm.prank(alice);
        vm.expectRevert(bytes("change pending"));
        vault.requestChange(MorayVault.ChangeKind.SetRecovery, recovery, 0);
    }

    function test_RequestZeroAddrReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("zero addr"));
        vault.requestChange(MorayVault.ChangeKind.SetSafe, address(0), 0);
    }

    function test_RequestSelfAsHelperReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("self"));
        vault.requestChange(MorayVault.ChangeKind.SetRecovery, alice, 0);
    }

    // ------------------------------------------------------------------ //
    //                   Dead Man's Switch (inheritance)                   //
    // ------------------------------------------------------------------ //

    function test_HeirCannotStartBeforeInactivity() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);

        vm.prank(heir);
        vm.expectRevert(bytes("still active"));
        vault.startInheritance(alice);
    }

    function test_InheritanceHappyPathAfterVeto() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);

        vm.warp(block.timestamp + 1001); // owner went silent
        vm.prank(heir);
        vault.startInheritance(alice);

        // cannot execute inside the veto window
        vm.prank(heir);
        vm.expectRevert(bytes("veto window"));
        vault.executeInheritance(alice);

        vm.warp(block.timestamp + VETO_DELAY);
        uint256 heirBefore = heir.balance;
        vm.prank(heir);
        vault.executeInheritance(alice);
        assertEq(heir.balance, heirBefore + 1 ether);
        assertEq(vault.balanceOf(alice), 0);
    }

    function test_CheckInCancelsInheritance() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        vm.warp(block.timestamp + 1001);
        vm.prank(heir);
        vault.startInheritance(alice);

        // owner proves life
        vm.prank(alice);
        vault.checkIn();

        vm.warp(block.timestamp + VETO_DELAY);
        vm.prank(heir);
        vm.expectRevert(bytes("no inheritance"));
        vault.executeInheritance(alice);
    }

    function test_AnyActivityCancelsInheritance() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        vm.warp(block.timestamp + 1001);
        vm.prank(heir);
        vault.startInheritance(alice);

        // an ordinary deposit is a sign of life
        _deposit(alice, 0.5 ether);

        vm.warp(block.timestamp + VETO_DELAY);
        vm.prank(heir);
        vm.expectRevert(bytes("no inheritance"));
        vault.executeInheritance(alice);
    }

    function test_InheritanceBlockedWhileFrozen() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        _setRecovery(alice, recovery);
        vm.warp(block.timestamp + 1001);
        vm.prank(heir);
        vault.startInheritance(alice);
        vm.warp(block.timestamp + VETO_DELAY);

        // recovery contact freezes to block a wrongful inheritance (does not
        // count as owner activity)
        vm.prank(recovery);
        vault.freeze(alice);

        vm.prank(heir);
        vm.expectRevert(bytes("frozen"));
        vault.executeInheritance(alice);
    }

    function test_NonHeirCannotStartOrExecute() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        vm.warp(block.timestamp + 1001);

        vm.prank(bob);
        vm.expectRevert(bytes("not heir"));
        vault.startInheritance(alice);
    }

    function test_InheritanceReclaimsPendingSends() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        // an old in-flight send that predates the silence
        vm.prank(alice);
        vault.send(bob, 0.3 ether, 0);

        vm.warp(block.timestamp + 1001);
        vm.prank(heir);
        vault.startInheritance(alice);
        vm.warp(block.timestamp + VETO_DELAY);

        uint256 heirBefore = heir.balance;
        vm.prank(heir);
        vault.executeInheritance(alice);
        assertEq(heir.balance, heirBefore + 1 ether); // 0.7 balance + 0.3 reclaimed
        assertEq(vault.activePendingCount(alice), 0);
    }

    // ------------------------------------------------------------------ //
    //                          Reentrancy                                 //
    // ------------------------------------------------------------------ //

    function test_ReentrancyOnWithdrawBlocked() public {
        ReentrantWithdraw attacker = new ReentrantWithdraw(vault);
        vm.deal(address(attacker), 1 ether);
        attacker.fund{value: 1 ether}();
        vm.expectRevert(); // inner re-entry trips the guard -> outer "send fail"
        attacker.attack(0.5 ether);
        assertEq(vault.balanceOf(address(attacker)), 1 ether); // nothing drained
    }

    function test_ReentrancyOnClaimBlocked() public {
        ReentrantClaim attacker = new ReentrantClaim(vault);
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(address(attacker), 0.3 ether, 0);
        attacker.arm(id);
        vm.warp(block.timestamp + MIN_DELAY);
        vm.expectRevert();
        vault.claim(id);
        // the send is untouched (still pending), nothing double-spent
        assertEq(uint256(_statusOf(id)), uint256(MorayVault.Status.Pending));
    }

    // ------------------------------------------------------------------ //
    //                        Solvency invariant                           //
    // ------------------------------------------------------------------ //

    function test_SolvencyAfterMixedActivity() public {
        _deposit(alice, 5 ether);
        _deposit(bob, 3 ether);
        _setSafe(alice, safe);

        vm.prank(alice);
        vault.send(carol, 1 ether, 0);
        vm.prank(bob);
        uint256 id = vault.send(carol, 0.5 ether, 0);
        vm.prank(alice);
        vault.withdraw(0.5 ether);

        vm.warp(block.timestamp + MIN_DELAY);
        vault.claim(id); // pay carol

        // accounted funds == real contract balance
        uint256 accounted = vault.balanceOf(alice) + vault.balanceOf(bob) + vault.balanceOf(carol);
        // still-pending amounts (alice's send to carol, id 0)
        (,, uint256 amt0,, MorayVault.Status s0) = vault.transfers(0);
        if (s0 == MorayVault.Status.Pending) accounted += amt0;
        assertEq(accounted, address(vault).balance);
    }
}

// ---------------------------------------------------------------------- //
//                        Malicious helpers                                //
// ---------------------------------------------------------------------- //

contract ReentrantWithdraw {
    MorayVault internal vault;
    bool internal armed;

    constructor(MorayVault _v) {
        vault = _v;
    }

    function fund() external payable {
        vault.deposit{value: msg.value}();
    }

    function attack(uint256 amt) external {
        armed = true;
        vault.withdraw(amt);
    }

    receive() external payable {
        if (armed) {
            armed = false;
            vault.withdraw(0.1 ether); // re-entry attempt
        }
    }
}

contract ReentrantClaim {
    MorayVault internal vault;
    uint256 internal id;

    constructor(MorayVault _v) {
        vault = _v;
    }

    function arm(uint256 _id) external {
        id = _id;
    }

    receive() external payable {
        vault.claim(id); // re-entry attempt on the same transfer
    }
}
