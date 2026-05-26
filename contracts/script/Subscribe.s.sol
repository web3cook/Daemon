// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Subscriptions}   from "../src/Subscriptions.sol";
import {IPermit2}        from "../src/interfaces/IPermit2.sol";
import {TestERC20}       from "./helpers/MockContracts.sol";

interface IPermit2Full is IPermit2 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function allowance(address owner, address token, address spender)
        external view returns (uint160 amount, uint48 expiration, uint48 nonce);
}

contract Subscribe is Script {
    bytes32 constant PERMIT_DETAILS_TYPEHASH = keccak256(
        "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );
    bytes32 constant PERMIT_SINGLE_TYPEHASH = keccak256(
        "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)"
        "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );

    uint256 constant SPEND_AMOUNT   = 10e6;       // 10 mUSDC per cycle
    uint256 constant INTERVAL       = 5 minutes;
    uint256 constant MAX_EXECUTIONS = 5;

    function run() external {
        string memory json = vm.readFile("./deployments/arbitrum-sepolia.json");

        address mockUSDC      = vm.parseJsonAddress(json, ".mockUSDC");
        address subscriptions = vm.parseJsonAddress(json, ".subscriptions");
        address sipService    = vm.parseJsonAddress(json, ".sipService");
        address permit2Addr   = vm.parseJsonAddress(json, ".permit2");

        uint256 subscriberKey = vm.envUint("PRIVATE_KEY");
        address subscriber    = vm.addr(subscriberKey);

        console.log("Subscriber:", subscriber);
        console.log("Subscriptions:", subscriptions);
        console.log("SIPService:", sipService);

        IPermit2Full p2   = IPermit2Full(permit2Addr);
        Subscriptions subs = Subscriptions(subscriptions);
        TestERC20 usdc    = TestERC20(mockUSDC);

        // mint enough mUSDC for all cycles
        uint256 totalNeeded = SPEND_AMOUNT * MAX_EXECUTIONS;
        vm.startBroadcast(subscriberKey);
        usdc.mint(subscriber, totalNeeded);

        // approve Permit2 to spend mUSDC
        usdc.approve(permit2Addr, type(uint256).max);

        // read current nonce from Permit2
        (, , uint48 permit2Nonce) = p2.allowance(subscriber, mockUSDC, subscriptions);

        // build PermitSingle
        uint48 expiration   = uint48(block.timestamp + 7 days);
        uint160 permitAmount = uint160(totalNeeded);

        IPermit2.PermitSingle memory permitSingle = IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token:      mockUSDC,
                amount:     permitAmount,
                expiration: expiration,
                nonce:      permit2Nonce
            }),
            spender:     subscriptions,
            sigDeadline: block.timestamp + 1 hours
        });

        // EIP-712 sign
        bytes32 domainSep = p2.DOMAIN_SEPARATOR();
        bytes32 detailsHash = keccak256(abi.encode(
            PERMIT_DETAILS_TYPEHASH,
            permitSingle.details.token,
            permitSingle.details.amount,
            permitSingle.details.expiration,
            permitSingle.details.nonce
        ));
        bytes32 structHash = keccak256(abi.encode(
            PERMIT_SINGLE_TYPEHASH,
            detailsHash,
            permitSingle.spender,
            permitSingle.sigDeadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(subscriberKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // subscribe
        subs.subscribe(
            sipService,
            mockUSDC,
            SPEND_AMOUNT,
            INTERVAL,
            MAX_EXECUTIONS,
            permitSingle,
            sig
        );

        vm.stopBroadcast();

        // compute and log the subscription id
        uint256 nonceBefore = subs.nonces(subscriber) - 1;
        bytes32 subId = keccak256(abi.encode(subscriber, sipService, mockUSDC, nonceBefore));
        console.log("Subscription created!");
        console.log("SUBSCRIPTION_ID (set as env var for Execute.s.sol):");
        console.logBytes32(subId);
    }
}
