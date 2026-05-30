// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Subscriptions}   from "../src/Subscriptions.sol";
import {SIPService}      from "../src/SIPService.sol";
import {TestERC20, TestAggregator} from "./helpers/MockContracts.sol";

contract DeployTestnet is Script {
    // Permit2 canonical address (same on all EVM chains)
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Max fee: 500 bps (5%) hardcoded at deploy
    uint256 constant MAX_FEE = 500;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("Deployer / executor / treasury:", deployer);

        vm.startBroadcast(deployerKey);

        // --- mock tokens ---
        TestERC20 mockUSDC = new TestERC20("Mock USDC", "mUSDC", 6);
        TestERC20 mockWETH = new TestERC20("Mock WETH", "mWETH", 18);
        console.log("mUSDC:", address(mockUSDC));
        console.log("mWETH:", address(mockWETH));

        // --- mock aggregator ---
        TestAggregator aggregator = new TestAggregator();
        console.log("TestAggregator:", address(aggregator));

        // --- core contracts ---
        // Permit2 is a hardcoded constant inside Subscriptions; only the executor is passed in.
        Subscriptions subs = new Subscriptions(deployer);
        SIPService    sip  = new SIPService(address(subs), deployer, MAX_FEE, address(aggregator));
        console.log("Subscriptions:", address(subs));
        console.log("SIPService:   ", address(sip));

        // --- wire up ---
        subs.registerService(address(sip));
        sip.addToken(address(mockWETH));

        vm.stopBroadcast();

        // --- save addresses ---
        string memory json = "deployment";
        vm.serializeAddress(json, "permit2",       PERMIT2);
        vm.serializeAddress(json, "mockUSDC",      address(mockUSDC));
        vm.serializeAddress(json, "mockWETH",      address(mockWETH));
        vm.serializeAddress(json, "aggregator",    address(aggregator));
        vm.serializeAddress(json, "subscriptions", address(subs));
        string memory out = vm.serializeAddress(json, "sipService", address(sip));

        vm.writeJson(out, "./deployments/arbitrum-sepolia.json");
        console.log("Addresses saved to ./deployments/arbitrum-sepolia.json");
    }
}
