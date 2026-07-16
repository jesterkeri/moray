// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MorayVault} from "../src/MorayVault.sol";

/// @notice Deploys MorayVault to Monad testnet.
///
/// Use an encrypted keystore, NOT a raw --private-key: a key passed as a CLI
/// argument lands in shell history and the process list. Create one once
/// (prompts for a password, prints only the address):
///   cast wallet new ~/.foundry/keystores moray-deployer
///
/// Then deploy:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url monad_testnet \
///     --account moray-deployer --sender <DEPLOYER_ADDRESS> \
///     --broadcast
///
/// Set MONAD_TESTNET_RPC in the env (see foundry.toml [rpc_endpoints]).
/// The deployer address needs testnet MON for gas (faucet.monad.xyz).
///
/// The deployer gets NO privileges: MorayVault has no owner and no admin, and
/// this constructor only sets the delay immutables. Once deployed, the key that
/// deployed it is powerless over the vault.
contract Deploy is Script {
    // Demo (testnet) delays — deliberately SHORT so every mechanic is visible in a
    // live 3-minute demo. Production would use much longer, meaningful windows.
    uint64 constant MIN_NEW_PAYEE_DELAY = 60; // new-payee anti-mistake hold     (prod ~1h)
    uint64 constant CONFIG_DELAY = 120; // config changes + safe maturity + unfreeze (prod ~24-48h)
    uint64 constant INHERITANCE_VETO_DELAY = 120; // dead-man's-switch veto window (prod ~7d)
    uint64 constant WITHDRAW_DELAY = 90; // large-exit (anti-drain) window      (prod ~1h)
    uint64 constant RECLAIM_GRACE = 600; // unclaimed-transfer return window    (prod ~1-7d)

    function run() external returns (MorayVault vault) {
        // The send()/withdraw() fraud window must not be shorter than the
        // new-payee hold, or a large send could clear faster than a withdrawal.
        require(WITHDRAW_DELAY >= MIN_NEW_PAYEE_DELAY, "withdraw < new-payee window");

        vm.startBroadcast();
        vault = new MorayVault(MIN_NEW_PAYEE_DELAY, CONFIG_DELAY, INHERITANCE_VETO_DELAY, WITHDRAW_DELAY, RECLAIM_GRACE);
        vm.stopBroadcast();

        console.log("MorayVault deployed at:", address(vault));
        console.log("  minNewPayeeDelay     :", MIN_NEW_PAYEE_DELAY);
        console.log("  configDelay          :", CONFIG_DELAY);
        console.log("  inheritanceVetoDelay :", INHERITANCE_VETO_DELAY);
        console.log("  withdrawDelay        :", WITHDRAW_DELAY);
        console.log("  reclaimGrace         :", RECLAIM_GRACE);
    }
}
