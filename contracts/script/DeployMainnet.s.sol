// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {ERC8004IdentityRegistry}   from "../src/ERC8004IdentityRegistry.sol";
import {ERC8004ValidationRegistry} from "../src/ERC8004ValidationRegistry.sol";
import {Subscriptions}             from "../src/Subscriptions.sol";
import {SIPService}                from "../src/SIPService.sol";

// ─────────────────────────────────────────────────────────────────────────────
// DeployMainnet — Arbitrum One
//
// Required env vars (set in .env):
//   PRIVATE_KEY                  deployer EOA private key
//   ARBITRUM_RPC_URL             mainnet RPC
//   ARBISCAN_API_KEY             for verification
//   EXECUTOR_ADDRESS             hot wallet that the agent backend uses to sign txs
//   TREASURY_ADDRESS             multisig or EOA that receives protocol fees
//   AGGREGATOR_ADDRESS           DEX router (e.g. Uniswap V3 SwapRouter02 on Arbitrum)
//   AGENT_CARD_URI               URL to the agent's .well-known/agent.json
//
// Token addresses (Arbitrum One — set in .env or override below):
//   WETH_ADDRESS                 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
//   WBTC_ADDRESS                 0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f
//   ARB_ADDRESS                  0x912CE59144191C1204E64559FE8253a0e49E6548
//
// Run:
//   forge script script/DeployMainnet.s.sol \
//     --rpc-url arbitrum_one \
//     --broadcast \
//     --verify \
//     -vvv
// ─────────────────────────────────────────────────────────────────────────────

contract DeployMainnet is Script {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint256 constant INITIAL_TRUST_SCORE = 80;
    uint256 constant MIN_TRUST_SCORE     = 50;
    uint256 constant MAX_FEE_BPS         = 100; // 1% hard cap

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        address executor   = vm.envAddress("EXECUTOR_ADDRESS");
        address treasury   = vm.envAddress("TREASURY_ADDRESS");
        address aggregator = vm.envAddress("AGGREGATOR_ADDRESS");
        string  memory agentCardURI = vm.envString("AGENT_CARD_URI");

        address weth = vm.envAddress("WETH_ADDRESS");
        address wbtc = vm.envAddress("WBTC_ADDRESS");
        address arb  = vm.envAddress("ARB_ADDRESS");

        console.log("=== DeployMainnet: Arbitrum One ===");
        console.log("Deployer:   ", deployer);
        console.log("Executor:   ", executor);
        console.log("Treasury:   ", treasury);
        console.log("Aggregator: ", aggregator);

        vm.startBroadcast(deployerKey);

        // ── 1. ERC8004 IdentityRegistry ───────────────────────────────────────
        ERC8004IdentityRegistry identityRegistry = new ERC8004IdentityRegistry();
        console.log("IdentityRegistry:", address(identityRegistry));

        // ── 2. ERC8004 ValidationRegistry  (deployer is the initial validator) ─
        ERC8004ValidationRegistry validationRegistry =
            new ERC8004ValidationRegistry(deployer);
        console.log("ValidationRegistry:", address(validationRegistry));

        // ── 3. Agent registers on-chain ───────────────────────────────────────
        // The executor EOA registers itself. Because the deployer is broadcasting,
        // the NFT mints to the deployer — transfer it to the executor post-deploy
        // if they differ. For a single-key setup deployer == executor.
        uint256 agentId = identityRegistry.register(agentCardURI);
        console.log("Agent registered. agentId:", agentId);

        // ── 4. Set initial trust score ────────────────────────────────────────
        validationRegistry.setScore(agentId, INITIAL_TRUST_SCORE);
        console.log("Trust score set:", INITIAL_TRUST_SCORE);

        // ── 5. Subscriptions ──────────────────────────────────────────────────
        Subscriptions subs = new Subscriptions(
            PERMIT2,
            address(validationRegistry),
            executor,
            agentId,
            MIN_TRUST_SCORE
        );
        console.log("Subscriptions:", address(subs));

        // ── 6. SIPService ─────────────────────────────────────────────────────
        SIPService sipService = new SIPService(
            address(subs),
            treasury,
            aggregator,
            MAX_FEE_BPS
        );
        console.log("SIPService:", address(sipService));

        // ── 7. Wire up ────────────────────────────────────────────────────────
        subs.registerService(address(sipService));

        sipService.addToken(weth);
        sipService.addToken(wbtc);
        sipService.addToken(arb);

        console.log("Service registered. Output tokens whitelisted:");
        console.log("  WETH:", weth);
        console.log("  WBTC:", wbtc);
        console.log("  ARB: ", arb);

        vm.stopBroadcast();

        // ── 8. Save addresses ─────────────────────────────────────────────────
        string memory json = "mainnet";
        vm.serializeAddress(json, "permit2",            PERMIT2);
        vm.serializeAddress(json, "weth",               weth);
        vm.serializeAddress(json, "wbtc",               wbtc);
        vm.serializeAddress(json, "arb",                arb);
        vm.serializeAddress(json, "aggregator",         aggregator);
        vm.serializeAddress(json, "identityRegistry",   address(identityRegistry));
        vm.serializeAddress(json, "validationRegistry", address(validationRegistry));
        vm.serializeUint   (json, "agentId",            agentId);
        vm.serializeAddress(json, "executor",           executor);
        vm.serializeAddress(json, "treasury",           treasury);
        vm.serializeAddress(json, "subscriptions",      address(subs));
        string memory out =
        vm.serializeAddress(json, "sipService",         address(sipService));

        vm.writeJson(out, "./deployments/arbitrum-mainnet.json");
        console.log("Addresses saved to ./deployments/arbitrum-mainnet.json");
    }
}
