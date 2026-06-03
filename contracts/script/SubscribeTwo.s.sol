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

// Creates 2 subscriptions with a 150-second (2.5 min) interval.
// Over 5 minutes each SIP executes twice → 4 total bot executions.
contract SubscribeTwo is Script {
    bytes32 constant PERMIT_DETAILS_TYPEHASH = keccak256(
        "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );
    bytes32 constant PERMIT_SINGLE_TYPEHASH = keccak256(
        "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)"
        "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );

    uint256 constant SPEND_AMOUNT_1 = 10e6;   // SIP 1: 10 mUSDC per cycle
    uint256 constant SPEND_AMOUNT_2 = 20e6;   // SIP 2: 20 mUSDC per cycle
    uint256 constant INTERVAL       = 150;     // 2.5 minutes in seconds
    uint48  constant EXPIRY_AFTER   = 20 minutes; // window: enough for several cycles

    function run() external {
        string memory json = vm.readFile("./deployments/arbitrum-sepolia.json");

        address mockUSDC      = vm.parseJsonAddress(json, ".mockUSDC");
        address subscriptions = vm.parseJsonAddress(json, ".subscriptions");
        address sipService    = vm.parseJsonAddress(json, ".sipService");
        address permit2Addr   = vm.parseJsonAddress(json, ".permit2");

        uint256 subscriberKey = vm.envUint("PRIVATE_KEY");
        address subscriber    = vm.addr(subscriberKey);

        IPermit2Full  p2   = IPermit2Full(permit2Addr);
        Subscriptions subs = Subscriptions(subscriptions);
        TestERC20     usdc = TestERC20(mockUSDC);

        uint48  expiration     = uint48(block.timestamp + EXPIRY_AFTER);
        uint256 executionCount = (uint256(expiration) - block.timestamp) / INTERVAL;

        uint256 totalNeeded1 = SPEND_AMOUNT_1 * executionCount;
        uint256 totalNeeded2 = SPEND_AMOUNT_2 * executionCount;

        console.log("Subscriber      :", subscriber);
        console.log("Interval        :", INTERVAL, "seconds");
        console.log("Expiry window   :", EXPIRY_AFTER, "seconds");
        console.log("Execution slots :", executionCount);

        vm.startBroadcast(subscriberKey);

        usdc.mint(subscriber, totalNeeded1 + totalNeeded2);
        usdc.approve(permit2Addr, type(uint256).max);

        // ── SIP 1 ──────────────────────────────────────────────────────────────
        (, , uint48 nonce1) = p2.allowance(subscriber, mockUSDC, subscriptions);
        bytes32 sub1Id = _subscribe(
            subs, p2, subscriberKey,
            mockUSDC, sipService, subscriptions, permit2Addr,
            SPEND_AMOUNT_1, uint160(totalNeeded1), expiration, nonce1
        );

        // ── SIP 2 ──────────────────────────────────────────────────────────────
        (, , uint48 nonce2) = p2.allowance(subscriber, mockUSDC, subscriptions);
        bytes32 sub2Id = _subscribe(
            subs, p2, subscriberKey,
            mockUSDC, sipService, subscriptions, permit2Addr,
            SPEND_AMOUNT_2, uint160(totalNeeded2), expiration, nonce2
        );

        vm.stopBroadcast();

        console.log("\n=== SIPs created ===");
        console.log("SIP 1 (10 mUSDC / 2.5 min):");
        console.logBytes32(sub1Id);
        console.log("SIP 2 (20 mUSDC / 2.5 min):");
        console.logBytes32(sub2Id);
        console.log("\nBot should execute each SIP at ~t+2.5min and ~t+5min");
    }

    function _subscribe(
        Subscriptions subs,
        IPermit2Full  p2,
        uint256       signerKey,
        address       token,
        address       service,
        address       subsAddr,
        address       permit2Addr,
        uint256       spendAmount,
        uint160       permitAmount,
        uint48        expiration,
        uint48        nonce
    ) internal returns (bytes32 subId) {
        IPermit2.PermitSingle memory ps = IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token:      token,
                amount:     permitAmount,
                expiration: expiration,
                nonce:      nonce
            }),
            spender:     subsAddr,
            sigDeadline: block.timestamp + 1 hours
        });

        bytes32 domainSep   = p2.DOMAIN_SEPARATOR();
        bytes32 detailsHash = keccak256(abi.encode(
            PERMIT_DETAILS_TYPEHASH,
            ps.details.token, ps.details.amount,
            ps.details.expiration, ps.details.nonce
        ));
        bytes32 structHash = keccak256(abi.encode(
            PERMIT_SINGLE_TYPEHASH, detailsHash, ps.spender, ps.sigDeadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);

        subs.subscribe(service, token, spendAmount, INTERVAL, ps, abi.encodePacked(r, s, v));

        uint256 nonceAfter = subs.nonces(vm.addr(signerKey)) - 1;
        subId = keccak256(abi.encode(vm.addr(signerKey), service, token, nonceAfter));
    }
}
