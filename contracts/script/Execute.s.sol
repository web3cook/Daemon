// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Subscriptions, Subscription} from "../src/Subscriptions.sol";
import {SIPService, SwapParams} from "../src/SIPService.sol";
import {TestERC20, TestAggregator} from "./helpers/MockContracts.sol";

contract Execute is Script {
    // Mock ETH price: 3000 USDC per ETH
    uint256 constant MOCK_ETH_PRICE_USDC = 3000;

    struct Addrs {
        address mockUSDC;
        address mockWETH;
        address aggregator;
        address subscriptions;
        address sipService;
    }

    function _loadAddrs() internal returns (Addrs memory a) {
        string memory json = vm.readFile("./deployments/arbitrum-sepolia.json");
        a.mockUSDC      = vm.parseJsonAddress(json, ".mockUSDC");
        a.mockWETH      = vm.parseJsonAddress(json, ".mockWETH");
        a.aggregator    = vm.parseJsonAddress(json, ".aggregator");
        a.subscriptions = vm.parseJsonAddress(json, ".subscriptions");
        a.sipService    = vm.parseJsonAddress(json, ".sipService");
    }

    function _buildParams(
        address mockUSDC,
        address mockWETH,
        address sipService,
        uint256 spendAmount,
        uint256 outputAmount
    ) internal pure returns (bytes memory) {
        bytes memory swapData = abi.encodeWithSelector(
            TestAggregator.swap.selector,
            mockUSDC,
            spendAmount,
            mockWETH,
            sipService,
            outputAmount
        );
        uint256 minOutput = outputAmount * 995 / 1000;
        return abi.encode(SwapParams({
            outputToken:     mockWETH,
            minOutputAmount: minOutput,
            swapData:        swapData
        }));
    }

    function run() external {
        Addrs memory a = _loadAddrs();
        bytes32 subId  = vm.envBytes32("SUBSCRIPTION_ID");

        uint256 executorKey = vm.envUint("PRIVATE_KEY");
        address executor    = vm.addr(executorKey);
        console.log("Executor:", executor);
        console.logBytes32(subId);

        Subscription memory sub = Subscriptions(a.subscriptions).getSubscription(subId);
        uint256 spendAmount  = sub.amountPerCycle;
        uint256 outputAmount = spendAmount * 1e18 / (MOCK_ETH_PRICE_USDC * 1e6);

        console.log("spendAmount (mUSDC):", spendAmount);
        console.log("outputAmount (mWETH):", outputAmount);

        bytes memory params = _buildParams(
            a.mockUSDC, a.mockWETH, a.sipService, spendAmount, outputAmount
        );

        vm.startBroadcast(executorKey);

        TestERC20(a.mockWETH).mint(a.aggregator, outputAmount);
        Subscriptions(a.subscriptions).execute(subId, params);

        vm.stopBroadcast();

        console.log("Execution successful!");
        console.log("Subscriber mWETH balance:", TestERC20(a.mockWETH).balanceOf(sub.subscriber));
    }
}
