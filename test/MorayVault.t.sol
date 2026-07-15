// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MorayVault} from "../src/MorayVault.sol";

/// @notice Behavioural + adversarial tests for MorayVault. Each security control
///         is tested for BOTH the happy path and the denied bad case.
contract MorayVaultTest is Test {
    MorayVault internal vault;

    uint64 internal constant MIN_DELAY = 60; // new-payee (anti-mistake) floor
    uint64 internal constant CONFIG_DELAY = 120; // powerful config changes / unfreeze
    uint64 internal constant VETO_DELAY = 180; // inheritance veto window
    uint64 internal constant WITHDRAW_DELAY = 90; // large-exit (anti-drain) window
    uint64 internal constant RECLAIM_GRACE = 3600; // recipient grace before sender can reclaim

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal heir = makeAddr("heir");
    address internal safe = makeAddr("safe");
    address internal recovery = makeAddr("recovery");

    function setUp() public {
        vm.warp(1_000_000);
        vault = new MorayVault(MIN_DELAY, CONFIG_DELAY, VETO_DELAY, WITHDRAW_DELAY, RECLAIM_GRACE);
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

    function _setInactivity(address u, uint256 period) internal {
        vm.prank(u);
        vault.requestChange(MorayVault.ChangeKind.SetInactivity, address(0), period);
    }

    /// @dev Raise the instant allowance the honest way (timelocked). Advances time
    ///      by CONFIG_DELAY.
    function _enableInstant(address u, uint256 limit) internal {
        vm.prank(u);
        vault.requestChange(MorayVault.ChangeKind.SetInstantLimit, address(0), limit);
        vm.warp(block.timestamp + CONFIG_DELAY);
        vm.prank(u);
        vault.executeChange();
    }

    /// @dev Send to a new payee and claim it, so `to` becomes a cleared payee.
    ///      The first send is floored (not instant), so it doesn't spend allowance.
    function _clearPayee(address u, address to, uint256 amt) internal {
        vm.prank(u);
        uint256 id = vault.send(to, amt, 0);
        vm.warp(_unlockOf(id));
        vault.claim(id);
    }

    function _unlockOf(uint256 id) internal view returns (uint64) {
        (,,, uint64 unlockTime,) = vault.transfers(id);
        return unlockTime;
    }

    function _statusOf(uint256 id) internal view returns (MorayVault.Status) {
        (,,,, MorayVault.Status s) = vault.transfers(id);
        return s;
    }

    function _safeAddr(address u) internal view returns (address s) {
        (s,,,,,,,,,) = vault.accounts(u);
    }

    function _instantLimit(address u) internal view returns (uint256 lim) {
        (,,,,,, lim,,,) = vault.accounts(u);
    }

    // ------------------------------------------------------------------ //
    //                     Deposit / hybrid withdraw                       //
    // ------------------------------------------------------------------ //

    function test_DepositCreditsBalance() public {
        _deposit(alice, 1 ether);
        assertEq(vault.balanceOf(alice), 1 ether);
    }

    /// The CRITICAL fix: a fresh/unconfigured account has a 0 instant allowance,
    /// so even a small withdrawal is a delayed, freezable exit — no instant drain.
    function test_WithdrawDefaultNoAllowanceIsDelayed() public {
        _deposit(alice, 1 ether);
        uint256 walletBefore = alice.balance;
        vm.prank(alice);
        (uint256 id, bool instant) = vault.withdraw(0.01 ether);
        assertFalse(instant);
        assertEq(vault.activePendingCount(alice), 1);
        assertEq(alice.balance, walletBefore); // nothing left the vault
        assertEq(vault.balanceOf(alice), 0.99 ether);
        assertEq(uint256(_statusOf(id)), uint256(MorayVault.Status.Pending));
    }

    function test_WithdrawZeroReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("zero"));
        vault.withdraw(0);
    }

    function test_WithdrawInsufficientReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("insufficient"));
        vault.withdraw(2 ether);
    }

    function test_SmallWithdrawInstantAfterRaisingLimit() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        uint256 walletBefore = alice.balance;
        vm.prank(alice);
        (, bool instant) = vault.withdraw(0.04 ether);
        assertTrue(instant);
        assertEq(alice.balance, walletBefore + 0.04 ether);
        assertEq(vault.balanceOf(alice), 0.96 ether);
        assertEq(vault.activePendingCount(alice), 0);
    }

    function test_LargeWithdrawIsDelayed() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        vm.prank(alice);
        (uint256 id, bool instant) = vault.withdraw(0.5 ether);
        assertFalse(instant);
        assertEq(_unlockOf(id), uint64(block.timestamp) + WITHDRAW_DELAY);

        vm.expectRevert(bytes("still clearing"));
        vault.claim(id);

        vm.warp(_unlockOf(id));
        uint256 walletBefore = alice.balance;
        vault.claim(id);
        assertEq(alice.balance, walletBefore + 0.5 ether);
    }

    function test_WithdrawOverRemainingAllowanceIsDelayed() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        vm.prank(alice);
        (, bool i1) = vault.withdraw(0.04 ether); // spends 0.04 of 0.05
        assertTrue(i1);
        vm.prank(alice);
        (, bool i2) = vault.withdraw(0.02 ether); // 0.02 > 0.01 remaining -> delayed
        assertFalse(i2);
    }

    function test_InstantAllowanceRefillsAfterWindow() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        vm.prank(alice);
        (, bool i1) = vault.withdraw(0.05 ether); // full allowance used
        assertTrue(i1);
        vm.prank(alice);
        (, bool i2) = vault.withdraw(0.01 ether); // none left -> delayed
        assertFalse(i2);

        vm.warp(block.timestamp + vault.INSTANT_WINDOW());
        vm.prank(alice);
        (, bool i3) = vault.withdraw(0.01 ether); // window rolled over -> instant again
        assertTrue(i3);
    }

    function test_FrozenBlocksInstantWithdraw() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        vm.prank(alice);
        vault.panic();
        vm.prank(alice);
        vm.expectRevert(bytes("frozen"));
        vault.withdraw(0.01 ether);
    }

    // ------------------------------------------------------------------ //
    //                    Instant-limit config rules                       //
    // ------------------------------------------------------------------ //

    function test_RaisingInstantLimitIsTimelocked() public {
        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.SetInstantLimit, address(0), 0.05 ether);
        assertEq(_instantLimit(alice), 0); // not applied during delay

        vm.prank(alice);
        vm.expectRevert(bytes("not matured"));
        vault.executeChange();

        vm.warp(block.timestamp + CONFIG_DELAY);
        vm.prank(alice);
        vault.executeChange();
        assertEq(_instantLimit(alice), 0.05 ether);
    }

    function test_LoweringInstantLimitIsInstant() public {
        _enableInstant(alice, 0.05 ether);
        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.SetInstantLimit, address(0), 0.01 ether);
        assertEq(_instantLimit(alice), 0.01 ether); // tightening applies immediately
    }

    function test_SetInstantLimitToZeroIsInstant() public {
        _enableInstant(alice, 0.05 ether);
        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.SetInstantLimit, address(0), 0);
        assertEq(_instantLimit(alice), 0);
    }

    // ------------------------------------------------------------------ //
    //              Send: unified egress policy (no bypass)                //
    // ------------------------------------------------------------------ //

    /// New payee, amount within allowance -> only the anti-mistake floor applies.
    function test_NewPayeeFloorRaisesWindow() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.02 ether, 0); // within allowance, but new payee
        assertEq(_unlockOf(id), uint64(block.timestamp) + MIN_DELAY);
        assertEq(vault.balanceOf(alice), 0.98 ether);
    }

    function test_RequestedDelayHonoredAboveFloor() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.2 ether, 200); // 200 > every floor
        assertEq(_unlockOf(id), uint64(block.timestamp) + 200);
    }

    function test_ClearedPayeeWithinAllowanceSendsInstant() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        _clearPayee(alice, bob, 0.02 ether); // first send floored, then claimed
        assertTrue(vault.cleared(alice, bob));

        vm.prank(alice);
        uint256 id = vault.send(bob, 0.02 ether, 0); // cleared + within allowance -> instant
        assertEq(_unlockOf(id), uint64(block.timestamp));
    }

    /// The MAJOR fix: a large send (over allowance) is delayed even to a cleared
    /// payee, so send() cannot be used to dodge the withdrawal limit.
    function test_LargeClearedSendIsDelayed() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        _clearPayee(alice, bob, 0.02 ether);

        vm.prank(alice);
        uint256 id = vault.send(bob, 0.5 ether, 0); // > allowance
        assertEq(_unlockOf(id), uint64(block.timestamp) + WITHDRAW_DELAY);
    }

    /// A stolen signer cannot drain the whole vault via send() faster than the
    /// large-exit delay (regression guard for the send() bypass).
    function test_StolenSignerCannotDrainViaSend() public {
        _deposit(alice, 1 ether); // instant allowance defaults to 0
        address attacker = makeAddr("attacker");
        vm.prank(alice);
        uint256 id = vault.send(attacker, 1 ether, 0);
        // delay = max(minNewPayeeDelay, withdrawDelay); here withdrawDelay wins
        assertEq(_unlockOf(id), uint64(block.timestamp) + WITHDRAW_DELAY);
        assertGt(_unlockOf(id), uint64(block.timestamp)); // definitely not instant
        vm.expectRevert(bytes("still clearing"));
        vault.claim(id);
    }

    function test_InstantSendConsumesAllowance() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        _clearPayee(alice, bob, 0.01 ether);

        vm.prank(alice);
        uint256 id1 = vault.send(bob, 0.03 ether, 0); // instant, consumes 0.03
        assertEq(_unlockOf(id1), uint64(block.timestamp));
        assertEq(vault.remainingInstantAllowance(alice), 0.02 ether);

        vm.prank(alice);
        uint256 id2 = vault.send(bob, 0.03 ether, 0); // 0.03 > 0.02 remaining -> delayed
        assertEq(_unlockOf(id2), uint64(block.timestamp) + WITHDRAW_DELAY);
    }

    /// Instant send and instant withdraw draw down ONE shared per-window allowance,
    /// so they cannot be combined in a block to exceed instantLimit.
    function test_InstantSendAndWithdrawShareOneAllowance() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        _clearPayee(alice, bob, 0.01 ether);

        vm.prank(alice);
        uint256 sid = vault.send(bob, 0.03 ether, 0); // instant, consumes 0.03
        assertEq(_unlockOf(sid), uint64(block.timestamp));
        assertEq(vault.remainingInstantAllowance(alice), 0.02 ether);

        vm.prank(alice);
        (, bool instant) = vault.withdraw(0.03 ether); // 0.03 > 0.02 remaining -> delayed
        assertFalse(instant);

        vm.prank(alice);
        (, bool instant2) = vault.withdraw(0.02 ether); // exactly the remainder -> instant
        assertTrue(instant2);
        assertEq(vault.remainingInstantAllowance(alice), 0);
    }

    function test_AllowanceRefillsAtWindowBoundaryMixed() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        _clearPayee(alice, bob, 0.01 ether);

        vm.prank(alice);
        uint256 sid = vault.send(bob, 0.05 ether, 0); // instant, exhausts the window
        assertEq(_unlockOf(sid), uint64(block.timestamp));
        assertEq(vault.remainingInstantAllowance(alice), 0);

        vm.prank(alice);
        (, bool i1) = vault.withdraw(0.01 ether); // before rollover -> delayed
        assertFalse(i1);

        vm.warp(block.timestamp + vault.INSTANT_WINDOW());
        vm.prank(alice);
        (, bool i2) = vault.withdraw(0.01 ether); // window rolled over -> instant
        assertTrue(i2);
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

    function test_UntrustRevokesInstantSend() public {
        _deposit(alice, 1 ether);
        _enableInstant(alice, 0.05 ether);
        _clearPayee(alice, bob, 0.02 ether);

        vm.prank(alice);
        uint256 id0 = vault.send(bob, 0.02 ether, 0); // cleared + within allowance -> instant
        assertEq(_unlockOf(id0), uint64(block.timestamp));

        vm.prank(alice);
        vault.untrust(bob);
        assertFalse(vault.cleared(alice, bob));

        vm.prank(alice);
        uint256 id1 = vault.send(bob, 0.02 ether, 0); // floor re-applied
        assertEq(_unlockOf(id1), uint64(block.timestamp) + MIN_DELAY);
    }

    // ------------------------------------------------------------------ //
    //                    Recall (cancel) & reclaim                        //
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
        vm.warp(_unlockOf(id));
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

    function test_ReclaimAfterGraceForStuckRecipient() public {
        RejectingRecipient r = new RejectingRecipient();
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(address(r), 0.3 ether, 0);

        vm.warp(_unlockOf(id));
        vm.expectRevert(bytes("send fail"));
        vault.claim(id); // recipient rejects native value

        vm.prank(alice);
        vm.expectRevert(bytes("window closed"));
        vault.cancel(id); // too late to cancel

        vm.warp(_unlockOf(id) + RECLAIM_GRACE);
        vm.prank(alice);
        vault.reclaim(id);
        assertEq(vault.balanceOf(alice), 1 ether);
        assertEq(vault.activePendingCount(alice), 0);
    }

    function test_ReclaimBeforeGraceReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);
        vm.warp(_unlockOf(id)); // unlocked, but inside grace
        vm.prank(alice);
        vm.expectRevert(bytes("grace not passed"));
        vault.reclaim(id);
    }

    function test_ReclaimByNonSenderReverts() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);
        vm.warp(_unlockOf(id) + RECLAIM_GRACE);
        vm.prank(bob);
        vm.expectRevert(bytes("not sender"));
        vault.reclaim(id);
    }

    // ------------------------------------------------------------------ //
    //                            Claim                                    //
    // ------------------------------------------------------------------ //

    function test_ClaimPaysAfterWindow() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);
        uint256 bobBefore = bob.balance;
        vm.warp(_unlockOf(id));
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
        vm.warp(_unlockOf(id));
        vm.expectRevert(bytes("sender frozen"));
        vault.claim(id);
    }

    function test_ClearedNotSetOnFailedClaim() public {
        RejectingRecipient r = new RejectingRecipient();
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(address(r), 0.3 ether, 0);
        vm.warp(_unlockOf(id));
        vm.expectRevert(bytes("send fail"));
        vault.claim(id);
        assertFalse(vault.cleared(alice, address(r))); // only a real cleared claim sets it
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

        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.Unfreeze, address(0), 0);

        vm.prank(alice);
        vm.expectRevert(bytes("not matured"));
        vault.executeChange();

        vm.warp(block.timestamp + CONFIG_DELAY);
        vm.prank(alice);
        vault.executeChange();

        // egress works again (delayed, since no instant allowance)
        vm.prank(alice);
        (, bool instant) = vault.withdraw(0.1 ether);
        assertFalse(instant);
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
        _setSafe(alice, safe); // set while empty -> instant
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vault.send(bob, 0.3 ether, 0);
        assertEq(vault.activePendingCount(alice), 1);

        uint256 safeBefore = safe.balance;
        uint256 vaultBefore = address(vault).balance;

        vm.warp(block.timestamp + CONFIG_DELAY); // mature the safe address
        vm.prank(alice);
        vault.killSwitch(alice);

        assertEq(safe.balance, safeBefore + 1 ether);
        assertEq(address(vault).balance, vaultBefore - 1 ether);
        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.activePendingCount(alice), 0);
        (,,,, MorayVault.Status s) = vault.transfers(0);
        assertEq(uint256(s), uint256(MorayVault.Status.Cancelled));

        vm.prank(alice);
        vm.expectRevert(bytes("frozen"));
        vault.withdraw(1); // stays frozen after sweep
    }

    function test_RecoveryContactCanKillSwitchButOnlyToSafe() public {
        _setSafe(alice, safe); // while empty -> instant
        _setRecovery(alice, recovery);
        _deposit(alice, 1 ether);

        uint256 safeBefore = safe.balance;
        uint256 recoveryBefore = recovery.balance;

        vm.warp(block.timestamp + CONFIG_DELAY); // mature the safe address
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
        _setSafe(alice, safe);
        _deposit(alice, 1 ether);
        vm.prank(bob);
        vm.expectRevert(bytes("not authorized"));
        vault.killSwitch(alice);
    }

    function test_ReentrancyOnKillSwitchBlocked() public {
        ReentrantKillSafe s = new ReentrantKillSafe(vault);
        s.target(alice);
        _setSafe(alice, address(s)); // while empty -> instant
        _setRecovery(alice, address(s)); // authorized re-entry -> must hit the guard
        _deposit(alice, 1 ether);

        vm.warp(block.timestamp + CONFIG_DELAY); // mature the safe address
        vm.prank(alice);
        vm.expectRevert(bytes("sweep fail"));
        vault.killSwitch(alice);
        assertEq(vault.balanceOf(alice), 1 ether); // rolled back, funds intact
    }

    /// User-config risk (documented): a safe address that rejects native value
    /// makes killSwitch revert cleanly; funds are not lost.
    function test_RejectingSafeBlocksKillSwitchFundsIntact() public {
        RejectingRecipient r = new RejectingRecipient();
        _setSafe(alice, address(r)); // while empty -> instant
        _deposit(alice, 1 ether);

        vm.warp(block.timestamp + CONFIG_DELAY); // mature the safe address
        vm.prank(alice);
        vm.expectRevert(bytes("sweep fail"));
        vault.killSwitch(alice);
        assertEq(vault.balanceOf(alice), 1 ether); // state reverts cleanly, recoverable
    }

    /// A safe address cannot be used by killSwitch until it has matured
    /// (configDelay after being set) — no fund-redirecting action is instant.
    function test_KillSwitchRejectsFreshSafeUntilMatured() public {
        _setSafe(alice, safe); // instant while empty, but not yet matured
        _deposit(alice, 1 ether);

        vm.prank(alice);
        vm.expectRevert(bytes("safe not matured"));
        vault.killSwitch(alice);

        vm.warp(block.timestamp + CONFIG_DELAY);
        uint256 safeBefore = safe.balance;
        vm.prank(alice);
        vault.killSwitch(alice);
        assertEq(safe.balance, safeBefore + 1 ether);
    }

    /// Pre-position attack (compromised-at-setup): a stolen signer sets a malicious
    /// safe while the vault is empty. The maturity gate blocks the opportunistic
    /// same-session sweep; a PATIENT attacker who waits out maturity can still
    /// drain — the documented, accepted "compromised at setup" residual.
    function test_PrepositionedSafeCannotInstantKillButMaturesForPatientAttacker() public {
        address attackerSafe = makeAddr("attackerSafe");
        _setSafe(alice, attackerSafe); // instant, because empty
        _deposit(alice, 10 ether); // user funds later

        vm.prank(alice);
        vm.expectRevert(bytes("safe not matured"));
        vault.killSwitch(alice); // NOT an instant drain

        vm.warp(block.timestamp + CONFIG_DELAY);
        uint256 attackerBefore = attackerSafe.balance;
        vm.prank(alice);
        vault.killSwitch(alice); // documented residual: works after maturity
        assertEq(attackerSafe.balance, attackerBefore + 10 ether);
    }

    // ------------------------------------------------------------------ //
    //          Timelocked config changes (incl. the CRITICAL fix)         //
    // ------------------------------------------------------------------ //

    function test_FirstSafeSetInstantWhenEmpty() public {
        _setSafe(alice, safe); // empty account -> instant
        assertEq(_safeAddr(alice), safe);
    }

    /// The CRITICAL fix: on a FUNDED account the first safe-set is timelocked, so
    /// a stolen signer cannot set safe=attacker and instantly killSwitch-drain.
    function test_CannotInstantSetSafeWhenFunded() public {
        _deposit(alice, 1 ether);
        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.SetSafe, safe, 0);
        assertEq(_safeAddr(alice), address(0)); // NOT instantly set

        vm.warp(block.timestamp + CONFIG_DELAY);
        vm.prank(alice);
        vault.executeChange();
        assertEq(_safeAddr(alice), safe);
    }

    function test_StolenSignerCannotSetSafeThenKillWhenFunded() public {
        _deposit(alice, 1 ether);
        address attackerSafe = makeAddr("attackerSafe");
        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.SetSafe, attackerSafe, 0); // timelocked, not instant

        vm.prank(alice);
        vm.expectRevert(bytes("no safe address"));
        vault.killSwitch(alice); // safe still unset -> cannot drain
    }

    function test_ConfigChangeToExistingSafeIsTimelocked() public {
        _setSafe(alice, safe); // instant (empty)
        assertEq(_safeAddr(alice), safe);

        address safe2 = makeAddr("safe2");
        vm.prank(alice);
        vault.requestChange(MorayVault.ChangeKind.SetSafe, safe2, 0);
        assertEq(_safeAddr(alice), safe); // unchanged during delay

        vm.prank(alice);
        vm.expectRevert(bytes("not matured"));
        vault.executeChange();

        vm.warp(block.timestamp + CONFIG_DELAY);
        vm.prank(alice);
        vault.executeChange();
        assertEq(_safeAddr(alice), safe2);
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
        assertEq(_safeAddr(alice), safe);
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

        vm.warp(block.timestamp + 1001);
        vm.prank(heir);
        vault.startInheritance(alice);

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

        _deposit(alice, 0.5 ether); // ordinary activity = sign of life

        vm.warp(block.timestamp + VETO_DELAY);
        vm.prank(heir);
        vm.expectRevert(bytes("no inheritance"));
        vault.executeInheritance(alice);
    }

    function test_OwnerSelfClaimCancelsInheritance() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);

        vm.warp(block.timestamp + 1001);
        vm.prank(heir);
        vault.startInheritance(alice);

        vm.prank(alice); // owner claims her own transfer -> proves life
        vault.claim(id);

        vm.warp(block.timestamp + VETO_DELAY);
        vm.prank(heir);
        vm.expectRevert(bytes("no inheritance"));
        vault.executeInheritance(alice);
    }

    function test_ThirdPartyClaimDoesNotProveLife() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        vm.prank(alice);
        uint256 id = vault.send(bob, 0.3 ether, 0);

        vm.warp(block.timestamp + 1001);
        vm.prank(heir);
        vault.startInheritance(alice);

        vm.prank(bob); // recipient (third party) claims -> NOT a sign of alice's life
        vault.claim(id);

        vm.warp(block.timestamp + VETO_DELAY);
        uint256 heirBefore = heir.balance;
        vm.prank(heir);
        vault.executeInheritance(alice); // still proceeds
        assertEq(heir.balance, heirBefore + 0.7 ether);
    }

    function test_PanicCancelsInheritance() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        vm.warp(block.timestamp + 1001);
        vm.prank(heir);
        vault.startInheritance(alice);

        vm.prank(alice);
        vault.panic(); // deliberate owner action -> proves life AND freezes

        vm.warp(block.timestamp + VETO_DELAY);
        vm.prank(heir);
        vm.expectRevert(bytes("no inheritance")); // cancelled, not merely frozen
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

        vm.prank(recovery); // recovery freeze does NOT count as owner life
        vault.freeze(alice);

        vm.prank(heir);
        vm.expectRevert(bytes("frozen"));
        vault.executeInheritance(alice);
    }

    function test_NonHeirCannotStart() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        vm.warp(block.timestamp + 1001);
        vm.prank(bob);
        vm.expectRevert(bytes("not heir"));
        vault.startInheritance(alice);
    }

    function test_NonHeirCannotExecute() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        vm.warp(block.timestamp + 1001);
        vm.prank(heir);
        vault.startInheritance(alice);
        vm.warp(block.timestamp + VETO_DELAY);
        vm.prank(bob);
        vm.expectRevert(bytes("not heir"));
        vault.executeInheritance(alice);
    }

    function test_InheritanceReclaimsPendingSends() public {
        _deposit(alice, 1 ether);
        _setHeir(alice, heir);
        _setInactivity(alice, 1000);
        vm.prank(alice);
        vault.send(bob, 0.3 ether, 0); // old in-flight send

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

    function test_ReentrancyOnInheritanceBlocked() public {
        ReentrantHeir h = new ReentrantHeir(vault);
        h.target(alice);
        _deposit(alice, 1 ether);
        _setHeir(alice, address(h));
        _setInactivity(alice, 1000);
        vm.warp(block.timestamp + 1001);
        h.start();
        vm.warp(block.timestamp + VETO_DELAY);

        vm.expectRevert(bytes("inherit fail"));
        h.exec();
        assertEq(vault.balanceOf(alice), 1 ether); // rolled back, nothing double-spent
    }

    // ------------------------------------------------------------------ //
    //                          Reentrancy                                 //
    // ------------------------------------------------------------------ //

    function test_ReentrancyOnInstantWithdrawBlocked() public {
        ReentrantWithdraw attacker = new ReentrantWithdraw(vault);
        vm.deal(address(attacker), 1 ether);
        attacker.fund{value: 1 ether}();
        attacker.raiseLimit(0.5 ether);
        vm.warp(block.timestamp + CONFIG_DELAY);
        attacker.finalizeLimit();

        vm.expectRevert(); // inner re-entry trips the guard -> outer "send fail"
        attacker.attack(0.1 ether);
        assertEq(vault.balanceOf(address(attacker)), 1 ether); // nothing drained
    }

    function test_ReentrancyOnClaimBlocked() public {
        ReentrantClaim attacker = new ReentrantClaim(vault);
        _deposit(alice, 1 ether);
        vm.prank(alice);
        uint256 id = vault.send(address(attacker), 0.3 ether, 0);
        attacker.arm(id);
        vm.warp(_unlockOf(id));
        vm.expectRevert();
        vault.claim(id);
        assertEq(uint256(_statusOf(id)), uint256(MorayVault.Status.Pending)); // untouched
    }

    // ------------------------------------------------------------------ //
    //                        Solvency invariant                           //
    // ------------------------------------------------------------------ //

    function test_SolvencyAfterMixedActivity() public {
        _setSafe(alice, safe); // while empty -> instant
        _deposit(alice, 5 ether);
        _deposit(bob, 3 ether);

        vm.prank(alice);
        vault.send(carol, 1 ether, 0);
        vm.prank(bob);
        uint256 id = vault.send(carol, 0.5 ether, 0);
        vm.prank(alice);
        vault.withdraw(0.5 ether); // delayed (no allowance) -> stays pending in the vault

        vm.warp(_unlockOf(id));
        vault.claim(id); // pay carol

        uint256 accounted = vault.balanceOf(alice) + vault.balanceOf(bob) + vault.balanceOf(carol);
        for (uint256 i = 0; i < vault.nextTransferId(); i++) {
            (,, uint256 amt,, MorayVault.Status s) = vault.transfers(i);
            if (s == MorayVault.Status.Pending) accounted += amt;
        }
        // No forced native value here, so the >= solvency invariant holds as equality.
        assertEq(accounted, address(vault).balance);
    }
}

// ---------------------------------------------------------------------- //
//                        Malicious helpers                                //
// ---------------------------------------------------------------------- //

contract RejectingRecipient {
    receive() external payable {
        revert("no thanks");
    }
}

contract ReentrantWithdraw {
    MorayVault internal vault;
    bool internal armed;

    constructor(MorayVault _v) {
        vault = _v;
    }

    function fund() external payable {
        vault.deposit{value: msg.value}();
    }

    function raiseLimit(uint256 limit) external {
        vault.requestChange(MorayVault.ChangeKind.SetInstantLimit, address(0), limit);
    }

    function finalizeLimit() external {
        vault.executeChange();
    }

    function attack(uint256 amt) external {
        armed = true;
        vault.withdraw(amt);
    }

    receive() external payable {
        if (armed) {
            armed = false;
            vault.withdraw(0.001 ether); // re-entry attempt
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

contract ReentrantKillSafe {
    MorayVault internal vault;
    address internal victim;

    constructor(MorayVault _v) {
        vault = _v;
    }

    function target(address v) external {
        victim = v;
    }

    receive() external payable {
        vault.killSwitch(victim); // re-entry attempt during the sweep
    }
}

contract ReentrantHeir {
    MorayVault internal vault;
    address internal victim;

    constructor(MorayVault _v) {
        vault = _v;
    }

    function target(address v) external {
        victim = v;
    }

    function start() external {
        vault.startInheritance(victim);
    }

    function exec() external {
        vault.executeInheritance(victim);
    }

    receive() external payable {
        vault.executeInheritance(victim); // re-entry attempt during the sweep
    }
}
