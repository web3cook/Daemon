// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {Subscriptions}             from "../src/Subscriptions.sol";
import {SIPService}                from "../src/SIPService.sol";
import {ServiceFactory}            from "../src/ServiceFactory.sol";
import {TestERC20, TestAggregator} from "./helpers/MockContracts.sol";

// ─────────────────────────────────────────────────────────────────────────────
// DeployTestnet — Arbitrum Sepolia
//
// Deployment order (each step depends on the one before):
//   1. Mock tokens (USDC, WETH, WBTC)
//   2. TestAggregator
//   3. Subscriptions              (permit2, executor EOA)
//   4. SIPService                 (subscriptions, feeReceiver, spendToken, minAmount, maxFeeBps, aggregator)
//   5. ServiceFactory             (subscriptions)
//   6. Wire: setFactory + registerService + addToken × 2
//   7. Mint test USDC to deployer
//   8. Save addresses to deployments/arbitrum-sepolia.json
//
// ERC-8004 registries are intentionally not deployed — agent identity and
// trust scores will be added later.
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

    // Maximum fee the SIPService owner can ever set (100 bps = 1%)
    uint256 constant MAX_FEE_BPS = 100;

    // Minimum per-cycle spend SIPService accepts at subscribe time (1 mUSDC)
    uint256 constant MIN_AMOUNT_PER_CYCLE = 1e6;

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
        // TestAggregator aggregator = new TestAggregator();
        // console.log("TestAggregator:", address(aggregator));

        // ── 3. Subscriptions ──────────────────────────────────────────────────
        Subscriptions subs = new Subscriptions(
            PERMIT2,
            deployer           // executor EOA (agent wallet)
        );
        console.log("Subscriptions:", address(subs));

        // ── 4. SIPService ─────────────────────────────────────────────────────
        // SIPService sipService = new SIPService(
        //     address(subs),
        //     deployer,          // feeReceiver (protocol fee recipient)
        //     address(mockUSDC), // spendToken subscribers pay with
        //     MIN_AMOUNT_PER_CYCLE,
        //     MAX_FEE_BPS,
        //     address(aggregator)
        // );
        // console.log("SIPService:", address(sipService));

        // ── 5. ServiceFactory ─────────────────────────────────────────────────
        ServiceFactory serviceFactory = new ServiceFactory(address(subs));
        console.log("ServiceFactory:", address(serviceFactory));

        // ── 6. Wire up ────────────────────────────────────────────────────────
        subs.setFactory(address(serviceFactory));
        // subs.registerService(address(sipService));
        // sipService.addToken(address(mockWETH));
        // sipService.addToken(address(mockWBTC));
        console.log("Factory set. Service registered. Output tokens whitelisted.");

        // ── 7. Mint test USDC so the deployer can create a subscription ───────
        mockUSDC.mint(deployer, 10_000e6); // 10,000 test USDC
        console.log("Minted 10,000 mUSDC to deployer");

        vm.stopBroadcast();

        // ── 8. Save addresses ─────────────────────────────────────────────────
        string memory json = "testnet";
        vm.serializeAddress(json, "permit2",            PERMIT2);
        vm.serializeAddress(json, "mockUSDC",           address(mockUSDC));
        vm.serializeAddress(json, "mockWETH",           address(mockWETH));
        vm.serializeAddress(json, "mockWBTC",           address(mockWBTC));
        // vm.serializeAddress(json, "aggregator",         address(aggregator));
        vm.serializeAddress(json, "subscriptions",      address(subs));
        // vm.serializeAddress(json, "sipService",         address(sipService));
        string memory out =
        vm.serializeAddress(json, "serviceFactory",     address(serviceFactory));

        vm.writeJson(out, "./deployments/arbitrum-sepolia.json");
        console.log("Addresses saved to ./deployments/arbitrum-sepolia.json");
    }
}
