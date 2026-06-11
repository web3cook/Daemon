// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {ERC8004IdentityRegistry}   from "../src/ERC8004IdentityRegistry.sol";
import {ERC8004ValidationRegistry} from "../src/ERC8004ValidationRegistry.sol";
import {Subscriptions}             from "../src/Subscriptions.sol";
import {SIPService}                from "../src/SIPService.sol";
import {TestERC20, TestAggregator} from "./helpers/MockContracts.sol";

// ─────────────────────────────────────────────────────────────────────────────
// DeployTestnet — Arbitrum Sepolia
//
// Deployment order (each step depends on the one before):
//   1. Mock tokens (USDC, WETH, WBTC)
//   2. TestAggregator
//   3. ERC8004IdentityRegistry
//   4. ERC8004ValidationRegistry  (deployer = initial validator)
//   5. Agent registers on-chain   → agentId
//   6. Validator sets trust score → agentId gets score 80
//   7. Subscriptions              (permit2, registry, agent EOA, agentId, minScore)
//   8. SIPService                 (subscriptions, treasury, aggregator, maxFeeBps)
//   9. Wire: registerService + addToken × 2
//  10. Mint test USDC to deployer
//  11. Save addresses to deployments/arbitrum-sepolia.json
//
// Run:
//   forge script script/DeployTestnet.s.sol \
//     --rpc-url arbitrum_sepolia \
//     --broadcast \
//     --verify \
//     -vvv
// ─────────────────────────────────────────────────────────────────────────────

contract DeployTestnet is Script {
    // Permit2 canonical address — same on every EVM chain including Sepolia
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Agent card hosted anywhere; on testnet a placeholder is fine
    string constant AGENT_CARD_URI = "https://sip.example.com/.well-known/agent.json";

    // Trust score given to the agent at deploy time
    uint256 constant INITIAL_TRUST_SCORE = 80;

    // Minimum trust score the Subscriptions contract accepts
    uint256 constant MIN_TRUST_SCORE = 50;

    // Maximum fee the SIPService owner can ever set (100 bps = 1%)
    uint256 constant MAX_FEE_BPS = 100;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("=== DeployTestnet: Arbitrum Sepolia ===");
        console.log("Deployer / Agent / Treasury:", deployer);

        vm.startBroadcast(deployerKey);

        // ── 1. Mock tokens ────────────────────────────────────────────────────
        TestERC20 mockUSDC = new TestERC20("Mock USDC",  "mUSDC", 6);
        TestERC20 mockWETH = new TestERC20("Mock WETH",  "mWETH", 18);
        TestERC20 mockWBTC = new TestERC20("Mock WBTC",  "mWBTC", 8);

        console.log("mockUSDC:", address(mockUSDC));
        console.log("mockWETH:", address(mockWETH));
        console.log("mockWBTC:", address(mockWBTC));

        // ── 2. TestAggregator ─────────────────────────────────────────────────
        TestAggregator aggregator = new TestAggregator();
        console.log("TestAggregator:", address(aggregator));

        // ── 3. ERC8004 IdentityRegistry ───────────────────────────────────────
        ERC8004IdentityRegistry identityRegistry = new ERC8004IdentityRegistry();
        console.log("IdentityRegistry:", address(identityRegistry));

        // ── 4. ERC8004 ValidationRegistry  (deployer is the initial validator) ─
        ERC8004ValidationRegistry validationRegistry =
            new ERC8004ValidationRegistry(deployer);
        console.log("ValidationRegistry:", address(validationRegistry));

        // ── 5. Agent registers on-chain ───────────────────────────────────────
        // The deployer IS the agent for testnet — one key does everything.
        uint256 agentId = identityRegistry.register(AGENT_CARD_URI);
        console.log("Agent registered. agentId:", agentId);

        // ── 6. Validator sets trust score ─────────────────────────────────────
        validationRegistry.setScore(agentId, INITIAL_TRUST_SCORE);
        console.log("Trust score set:", INITIAL_TRUST_SCORE);

        // ── 7. Subscriptions ──────────────────────────────────────────────────
        Subscriptions subs = new Subscriptions(
            PERMIT2,
            address(validationRegistry),
            deployer,          // executor EOA (agent wallet)
            agentId,
            MIN_TRUST_SCORE
        );
        console.log("Subscriptions:", address(subs));

        // ── 8. SIPService ─────────────────────────────────────────────────────
        SIPService sipService = new SIPService(
            address(subs),
            deployer,          // treasury (protocol fee recipient)
            address(aggregator),
            MAX_FEE_BPS
        );
        console.log("SIPService:", address(sipService));

        // ── 9. Wire up ────────────────────────────────────────────────────────
        subs.registerService(address(sipService));
        sipService.addToken(address(mockWETH));
        sipService.addToken(address(mockWBTC));
        console.log("Service registered. Output tokens whitelisted.");

        // ── 10. Mint test USDC so the deployer can create a subscription ──────
        mockUSDC.mint(deployer, 10_000e6); // 10,000 test USDC
        console.log("Minted 10,000 mUSDC to deployer");

        vm.stopBroadcast();

        // ── 11. Save addresses ────────────────────────────────────────────────
        string memory json = "testnet";
        vm.serializeAddress(json, "permit2",            PERMIT2);
        vm.serializeAddress(json, "mockUSDC",           address(mockUSDC));
        vm.serializeAddress(json, "mockWETH",           address(mockWETH));
        vm.serializeAddress(json, "mockWBTC",           address(mockWBTC));
        vm.serializeAddress(json, "aggregator",         address(aggregator));
        vm.serializeAddress(json, "identityRegistry",   address(identityRegistry));
        vm.serializeAddress(json, "validationRegistry", address(validationRegistry));
        vm.serializeUint   (json, "agentId",            agentId);
        vm.serializeAddress(json, "subscriptions",      address(subs));
        string memory out =
        vm.serializeAddress(json, "sipService",         address(sipService));

        vm.writeJson(out, "./deployments/arbitrum-sepolia.json");
        console.log("Addresses saved to ./deployments/arbitrum-sepolia.json");
    }
}
