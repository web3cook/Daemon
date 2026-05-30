// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {
    Subscriptions,
    Subscription,
    NotExecutor,
    ServiceNotRegistered,
    ServiceAlreadyRegistered,
    PermitAmountTooLow,
    PermitExpired,
    PermitSpenderMismatch,
    PermitTokenMismatch,
    SubscriptionNotActive,
    NotSubscriber,
    TooEarly,
    InsufficientSubscriptionAmount,
    ZeroAmount,
    ZeroInterval,
    ZeroAddress
} from "../src/Subscriptions.sol";
import {IPermit2}  from "../src/interfaces/IPermit2.sol";
import {IService}  from "../src/interfaces/IService.sol";

// Extra Permit2 surface needed by the tests (domain separator + allowance/nonce reads).
interface IPermit2Ext is IPermit2 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function allowance(address owner, address token, address spender)
        external view returns (uint160 amount, uint48 expiration, uint48 nonce);
}

// ── Events (file-level in Subscriptions.sol, redeclared here for vm.expectEmit) ──

event SubscriptionCreated(
    bytes32 indexed id,
    address indexed subscriber,
    address indexed service,
    address spendToken,
    uint256 amountPerCycle,
    uint256 interval,
    uint48  permitExpiry
);
event SubscriptionCancelled(bytes32 indexed id, address indexed subscriber);
event Executed(
    bytes32 indexed id,
    address indexed subscriber,
    address indexed service,
    uint256 amount,
    uint256 executedAt
);
event ExecutorSet(address indexed executor, bool enabled);
event ServiceRegistered(address indexed service);
event ServiceRemoved(address indexed service);

// ── Mocks ────────────────────────────────────────────────────────────────────

contract MintableERC20 is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory name_, string memory symbol_, uint8 dec_) ERC20(name_, symbol_) {
        _dec = dec_;
    }

    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockService is IService {
    address public lastSubscriber;
    address public lastSpendToken;
    uint256 public lastAmount;
    bytes   public lastParams;
    uint256 public callCount;

    address public reentrantTarget;
    bytes32 public reentrantId;
    bytes   public reentrantParams;

    function execute(
        address subscriber,
        address spendToken,
        uint256 amount,
        bytes calldata params
    ) external returns (bool) {
        lastSubscriber = subscriber;
        lastSpendToken = spendToken;
        lastAmount     = amount;
        lastParams     = params;
        callCount++;

        if (reentrantTarget != address(0)) {
            Subscriptions(reentrantTarget).execute(reentrantId, reentrantParams);
        }

        return true;
    }

    function setReentrant(address target, bytes32 id, bytes calldata params) external {
        reentrantTarget = target;
        reentrantId     = id;
        reentrantParams = params;
    }
}

// ── Test contract ─────────────────────────────────────────────────────────────
//
// These are FORK tests: they run against the real, canonical Permit2 deployment.
// Requires the ARBITRUM_SEPOLIA_RPC_URL env var to be set (see .env.example).
//   forge test --match-contract SubscriptionsTest
//
contract SubscriptionsTest is Test {
    // Canonical Permit2 address — identical across chains and hardcoded in Subscriptions.
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    bytes32 constant PERMIT_DETAILS_TYPEHASH = keccak256(
        "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );
    bytes32 constant PERMIT_SINGLE_TYPEHASH = keccak256(
        "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)"
        "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );

    Subscriptions subs;
    MockService   service;
    MintableERC20 token;

    uint256 subscriberKey = 0xA11CE;
    address subscriber;
    address owner      = makeAddr("owner");
    address executor   = makeAddr("executor");
    address stranger   = makeAddr("stranger");

    uint256 constant AMOUNT   = 100e6;
    uint256 constant INTERVAL = 1 days;
    uint48  constant CYCLES   = 30;            // subscription window = CYCLES * INTERVAL

    // ── Setup ────────────────────────────────────────────────────────────────

    function setUp() public {
        // Fork a chain that has the canonical Permit2 deployed.
        vm.createSelectFork(vm.envString("ARBITRUM_SEPOLIA_RPC_URL"));

        subscriber = vm.addr(subscriberKey);

        token   = new MintableERC20("USD Coin", "USDC", 6);
        service = new MockService();

        vm.prank(owner);
        subs = new Subscriptions(executor);

        vm.prank(owner);
        subs.registerService(address(service));

        // Fund the subscriber and grant Permit2 the ERC-20 allowance it pulls against.
        token.mint(subscriber, AMOUNT * CYCLES);
        vm.prank(subscriber);
        token.approve(PERMIT2, type(uint256).max);
    }

    // ── Permit helpers ─────────────────────────────────────────────────────────

    function _permit2Nonce() internal view returns (uint48 nonce) {
        (, , nonce) = IPermit2Ext(PERMIT2).allowance(subscriber, address(token), address(subs));
    }

    function _buildPermit(uint160 amount, uint48 expiration)
        internal
        view
        returns (IPermit2.PermitSingle memory p)
    {
        p = IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token:      address(token),
                amount:     amount,
                expiration: expiration,
                nonce:      _permit2Nonce()
            }),
            spender:     address(subs),
            sigDeadline: block.timestamp + 1 hours
        });
    }

    function _sign(IPermit2.PermitSingle memory p) internal view returns (bytes memory) {
        bytes32 detailsHash = keccak256(abi.encode(
            PERMIT_DETAILS_TYPEHASH,
            p.details.token,
            p.details.amount,
            p.details.expiration,
            p.details.nonce
        ));
        bytes32 structHash = keccak256(abi.encode(
            PERMIT_SINGLE_TYPEHASH,
            detailsHash,
            p.spender,
            p.sigDeadline
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            IPermit2Ext(PERMIT2).DOMAIN_SEPARATOR(),
            structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(subscriberKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // Subscribes with a valid signed permit covering the full window.
    function _subscribe() internal returns (bytes32 id, uint48 expiration) {
        expiration = uint48(block.timestamp + uint256(INTERVAL) * CYCLES);
        IPermit2.PermitSingle memory p = _buildPermit(uint160(AMOUNT * CYCLES), expiration);
        bytes memory sig = _sign(p);

        id = keccak256(abi.encode(subscriber, address(service), address(token), subs.nonces(subscriber)));
        vm.prank(subscriber);
        subs.subscribe(address(service), address(token), AMOUNT, INTERVAL, p, sig);
    }

    function _execute(bytes32 id) internal {
        vm.prank(executor);
        subs.execute(id, "");
    }

    function _warpInterval() internal {
        vm.warp(block.timestamp + INTERVAL);
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    function test_constructor_revertsOnZeroExecutor() public {
        vm.expectRevert(ZeroAddress.selector);
        new Subscriptions(address(0));
    }

    function test_constructor_setsExecutor() public view {
        assertTrue(subs.isExecutor(executor));
    }

    function test_constructor_emitsExecutorSet() public {
        vm.expectEmit(true, false, false, true);
        emit ExecutorSet(executor, true);
        new Subscriptions(executor);
    }

    function test_permit2_isCanonicalAddress() public view {
        assertEq(address(subs.permit2()), PERMIT2);
    }

    // ── registerService ──────────────────────────────────────────────────────

    function test_registerService_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        subs.registerService(makeAddr("newSvc"));
    }

    function test_registerService_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ZeroAddress.selector);
        subs.registerService(address(0));
    }

    function test_registerService_revertsOnDuplicate() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ServiceAlreadyRegistered.selector, address(service)));
        subs.registerService(address(service));
    }

    function test_registerService_setsFlag() public {
        address newSvc = makeAddr("newSvc");
        vm.prank(owner);
        subs.registerService(newSvc);
        assertTrue(subs.isServiceRegistered(newSvc));
    }

    function test_registerService_emitsEvent() public {
        address newSvc = makeAddr("newSvc");
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit ServiceRegistered(newSvc);
        subs.registerService(newSvc);
    }

    // ── removeService ────────────────────────────────────────────────────────

    function test_removeService_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        subs.removeService(address(service));
    }

    function test_removeService_revertsIfNotRegistered() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ServiceNotRegistered.selector, stranger));
        subs.removeService(stranger);
    }

    function test_removeService_clearsFlag() public {
        vm.prank(owner);
        subs.removeService(address(service));
        assertFalse(subs.isServiceRegistered(address(service)));
    }

    function test_removeService_emitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit ServiceRemoved(address(service));
        subs.removeService(address(service));
    }

    // ── setExecutor ──────────────────────────────────────────────────────────

    function test_setExecutor_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        subs.setExecutor(stranger, true);
    }

    function test_setExecutor_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ZeroAddress.selector);
        subs.setExecutor(address(0), true);
    }

    function test_setExecutor_enables() public {
        vm.prank(owner);
        subs.setExecutor(stranger, true);
        assertTrue(subs.isExecutor(stranger));
    }

    function test_setExecutor_disables() public {
        vm.prank(owner);
        subs.setExecutor(executor, false);
        assertFalse(subs.isExecutor(executor));
    }

    function test_setExecutor_emitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit ExecutorSet(stranger, true);
        subs.setExecutor(stranger, true);
    }

    // ── pause / unpause ──────────────────────────────────────────────────────

    function test_pause_revertsIfNotOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        subs.pause();
    }

    function test_unpause_revertsIfNotOwner() public {
        vm.prank(owner);
        subs.pause();
        vm.prank(stranger);
        vm.expectRevert();
        subs.unpause();
    }

    function test_subscribe_revertsWhenPaused() public {
        vm.prank(owner);
        subs.pause();
        IPermit2.PermitSingle memory p = _buildPermit(uint160(AMOUNT * CYCLES), uint48(block.timestamp + INTERVAL * CYCLES));
        vm.prank(subscriber);
        vm.expectRevert();
        subs.subscribe(address(service), address(token), AMOUNT, INTERVAL, p, "");
    }

    function test_execute_revertsWhenPaused() public {
        (bytes32 id, ) = _subscribe();
        _warpInterval();
        vm.prank(owner);
        subs.pause();
        vm.prank(executor);
        vm.expectRevert();
        subs.execute(id, "");
    }

    function test_subscribe_worksAfterUnpause() public {
        vm.startPrank(owner);
        subs.pause();
        subs.unpause();
        vm.stopPrank();
        (bytes32 id, ) = _subscribe();
        assertEq(subs.getSubscription(id).subscriber, subscriber);
    }

    // ── subscribe() — validation ─────────────────────────────────────────────

    function test_subscribe_revertsServiceNotRegistered() public {
        IPermit2.PermitSingle memory p = _buildPermit(uint160(AMOUNT * CYCLES), uint48(block.timestamp + INTERVAL * CYCLES));
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(ServiceNotRegistered.selector, stranger));
        subs.subscribe(stranger, address(token), AMOUNT, INTERVAL, p, "");
    }

    function test_subscribe_revertsZeroAmount() public {
        IPermit2.PermitSingle memory p = _buildPermit(uint160(AMOUNT * CYCLES), uint48(block.timestamp + INTERVAL * CYCLES));
        vm.prank(subscriber);
        vm.expectRevert(ZeroAmount.selector);
        subs.subscribe(address(service), address(token), 0, INTERVAL, p, "");
    }

    function test_subscribe_revertsAmountAboveUint160Max() public {
        uint256 tooBig = uint256(type(uint160).max) + 1;
        IPermit2.PermitSingle memory p = _buildPermit(0, uint48(block.timestamp + INTERVAL * CYCLES));
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitAmountTooLow.selector, uint160(0), tooBig));
        subs.subscribe(address(service), address(token), tooBig, INTERVAL, p, "");
    }

    function test_subscribe_revertsZeroInterval() public {
        IPermit2.PermitSingle memory p = _buildPermit(uint160(AMOUNT * CYCLES), uint48(block.timestamp + INTERVAL * CYCLES));
        vm.prank(subscriber);
        vm.expectRevert(ZeroInterval.selector);
        subs.subscribe(address(service), address(token), AMOUNT, 0, p, "");
    }

    function test_subscribe_revertsPermitTokenMismatch() public {
        IPermit2.PermitSingle memory p = _buildPermit(uint160(AMOUNT * CYCLES), uint48(block.timestamp + INTERVAL * CYCLES));
        address wrongToken = makeAddr("wrongToken");
        p.details.token = wrongToken;
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitTokenMismatch.selector, address(token), wrongToken));
        subs.subscribe(address(service), address(token), AMOUNT, INTERVAL, p, "");
    }

    function test_subscribe_revertsPermitSpenderMismatch() public {
        IPermit2.PermitSingle memory p = _buildPermit(uint160(AMOUNT * CYCLES), uint48(block.timestamp + INTERVAL * CYCLES));
        p.spender = stranger;
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitSpenderMismatch.selector, address(subs), stranger));
        subs.subscribe(address(service), address(token), AMOUNT, INTERVAL, p, "");
    }

    // Permit amount must cover amountPerCycle * (window / interval).
    function test_subscribe_revertsPermitAmountTooLow() public {
        uint48  expiration     = uint48(block.timestamp + INTERVAL * 10);
        uint256 executionCount = 10;
        uint160 shortAmount    = uint160(AMOUNT * executionCount) - 1;
        IPermit2.PermitSingle memory p = _buildPermit(shortAmount, expiration);
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitAmountTooLow.selector, shortAmount, AMOUNT * executionCount));
        subs.subscribe(address(service), address(token), AMOUNT, INTERVAL, p, "");
    }

    function test_subscribe_revertsPermitExpiredAtCurrentTimestamp() public {
        uint48 expiration = uint48(block.timestamp); // not strictly greater than now
        IPermit2.PermitSingle memory p = _buildPermit(uint160(AMOUNT), expiration);
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitExpired.selector, expiration));
        subs.subscribe(address(service), address(token), AMOUNT, INTERVAL, p, "");
    }

    // ── subscribe() — happy path ─────────────────────────────────────────────

    function test_subscribe_storesCorrectState() public {
        uint256 ts = block.timestamp;
        (bytes32 id, uint48 expiration) = _subscribe();

        Subscription memory sub = subs.getSubscription(id);
        assertEq(sub.subscriber,            subscriber);
        assertEq(sub.service,               address(service));
        assertEq(sub.spendToken,            address(token));
        assertEq(sub.amountPerCycle,        AMOUNT);
        assertEq(sub.interval,              INTERVAL);
        assertEq(sub.lastExecutionTime,     ts);
        assertEq(sub.subscriptionStartTime, ts);
        assertEq(sub.permitExpiry,          expiration);
    }

    function test_subscribe_lastExecutionTimeEqualsBlockTimestamp() public {
        vm.warp(block.timestamp + 12345);
        uint256 ts = block.timestamp;
        (bytes32 id, ) = _subscribe();
        assertEq(subs.getSubscription(id).lastExecutionTime, ts);
    }

    function test_subscribe_registersPermit2Allowance() public {
        (, uint48 expiration) = _subscribe();
        (uint160 amount, uint48 exp, ) =
            IPermit2Ext(PERMIT2).allowance(subscriber, address(token), address(subs));
        assertEq(amount, uint160(AMOUNT * CYCLES));
        assertEq(exp,    expiration);
    }

    function test_subscribe_incrementsNonce() public {
        assertEq(subs.nonces(subscriber), 0);
        _subscribe();
        assertEq(subs.nonces(subscriber), 1);
        _subscribe();
        assertEq(subs.nonces(subscriber), 2);
    }

    function test_subscribe_idDeterministic() public {
        uint256 nonce      = subs.nonces(subscriber);
        bytes32 expectedId = keccak256(abi.encode(subscriber, address(service), address(token), nonce));
        (bytes32 actualId, ) = _subscribe();
        assertEq(actualId, expectedId);
    }

    function test_subscribe_twoSubsProduceDifferentIds() public {
        (bytes32 id1, ) = _subscribe();
        (bytes32 id2, ) = _subscribe();
        assertTrue(id1 != id2);
    }

    function test_subscribe_emitsSubscriptionCreated() public {
        uint48  expiration = uint48(block.timestamp + uint256(INTERVAL) * CYCLES);
        IPermit2.PermitSingle memory p = _buildPermit(uint160(AMOUNT * CYCLES), expiration);
        bytes memory sig = _sign(p);

        uint256 nonce      = subs.nonces(subscriber);
        bytes32 expectedId = keccak256(abi.encode(subscriber, address(service), address(token), nonce));

        vm.expectEmit(true, true, true, true);
        emit SubscriptionCreated(expectedId, subscriber, address(service), address(token), AMOUNT, INTERVAL, expiration);
        vm.prank(subscriber);
        subs.subscribe(address(service), address(token), AMOUNT, INTERVAL, p, sig);
    }

    // ── cancel() ─────────────────────────────────────────────────────────────

    function test_cancel_revertsIfNotSubscriber() public {
        (bytes32 id, ) = _subscribe();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(NotSubscriber.selector, id));
        subs.cancel(id);
    }

    function test_cancel_revertsIfOwnerTriesToCancel() public {
        (bytes32 id, ) = _subscribe();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(NotSubscriber.selector, id));
        subs.cancel(id);
    }

    function test_cancel_revertsIfExecutorTriesToCancel() public {
        (bytes32 id, ) = _subscribe();
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(NotSubscriber.selector, id));
        subs.cancel(id);
    }

    function test_cancel_revertsIfAlreadyCancelled() public {
        (bytes32 id, ) = _subscribe();
        vm.prank(subscriber);
        subs.cancel(id);
        vm.warp(block.timestamp + 1); // permitExpiry now strictly in the past
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionNotActive.selector, id));
        subs.cancel(id);
    }

    function test_cancel_setsPermitExpiryToNow() public {
        (bytes32 id, ) = _subscribe();
        vm.prank(subscriber);
        subs.cancel(id);
        assertEq(subs.getSubscription(id).permitExpiry, block.timestamp);
    }

    function test_cancel_emitsSubscriptionCancelled() public {
        (bytes32 id, ) = _subscribe();
        vm.expectEmit(true, true, false, false);
        emit SubscriptionCancelled(id, subscriber);
        vm.prank(subscriber);
        subs.cancel(id);
    }

    // ── execute() — validation ───────────────────────────────────────────────

    function test_execute_revertsIfNotExecutor() public {
        (bytes32 id, ) = _subscribe();
        _warpInterval();
        vm.prank(stranger);
        vm.expectRevert(NotExecutor.selector);
        subs.execute(id, "");
    }

    function test_execute_revertsIfServiceRemovedAfterSubscription() public {
        (bytes32 id, ) = _subscribe();
        vm.prank(owner);
        subs.removeService(address(service));
        _warpInterval();
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(ServiceNotRegistered.selector, address(service)));
        subs.execute(id, "");
    }

    function test_execute_revertsIfCancelled() public {
        (bytes32 id, ) = _subscribe();
        vm.prank(subscriber);
        subs.cancel(id);
        vm.warp(block.timestamp + 1); // push past the cancelled (now-) expiry
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionNotActive.selector, id));
        subs.execute(id, "");
    }

    function test_execute_revertsTooEarly() public {
        (bytes32 id, ) = _subscribe();
        _warpInterval();
        _execute(id); // lastExecutionTime = now
        vm.warp(block.timestamp + INTERVAL - 1); // one second short of the next window
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(TooEarly.selector, id, block.timestamp));
        subs.execute(id, "");
    }

    function test_execute_revertsWhenExpired() public {
        uint48 shortExpiry = uint48(block.timestamp + 1 hours);
        IPermit2.PermitSingle memory p = _buildPermit(uint160(AMOUNT), shortExpiry);
        bytes memory sig = _sign(p);
        bytes32 id = keccak256(abi.encode(subscriber, address(service), address(token), subs.nonces(subscriber)));
        vm.prank(subscriber);
        subs.subscribe(address(service), address(token), AMOUNT, INTERVAL, p, sig);

        vm.warp(uint256(shortExpiry) + 1);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionNotActive.selector, id));
        subs.execute(id, "");
    }

    function test_execute_revertsInsufficientBalance() public {
        (bytes32 id, ) = _subscribe();
        // Drain the subscriber so the balance check fails. Read the balance before
        // pranking — otherwise the balanceOf() call consumes the prank.
        uint256 bal = token.balanceOf(subscriber);
        vm.prank(subscriber);
        token.transfer(stranger, bal);
        _warpInterval();
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(InsufficientSubscriptionAmount.selector, id, 0, AMOUNT));
        subs.execute(id, "");
    }

    // ── execute() — happy path ────────────────────────────────────────────────

    function test_execute_movesTokensToService() public {
        (bytes32 id, ) = _subscribe();
        uint256 subBalBefore = token.balanceOf(subscriber);
        _warpInterval();
        _execute(id);
        assertEq(token.balanceOf(address(service)), AMOUNT);
        assertEq(token.balanceOf(subscriber),       subBalBefore - AMOUNT);
    }

    function test_execute_callsServiceExecute() public {
        (bytes32 id, ) = _subscribe();
        _warpInterval();
        bytes memory params = abi.encode(uint256(42));
        vm.prank(executor);
        subs.execute(id, params);
        assertEq(service.lastSubscriber(), subscriber);
        assertEq(service.lastSpendToken(), address(token));
        assertEq(service.lastAmount(),     AMOUNT);
        assertEq(service.lastParams(),     params);
    }

    function test_execute_updatesLastExecutionTime() public {
        (bytes32 id, ) = _subscribe();
        _warpInterval();
        uint256 execTime = block.timestamp;
        _execute(id);
        assertEq(subs.getSubscription(id).lastExecutionTime, execTime);
    }

    function test_execute_succeedsExactlyAtInterval() public {
        (bytes32 id, ) = _subscribe();
        vm.warp(subs.getSubscription(id).lastExecutionTime + INTERVAL); // exact boundary
        _execute(id);
        assertEq(subs.getSubscription(id).lastExecutionTime, block.timestamp);
    }

    function test_execute_emitsExecuted() public {
        (bytes32 id, ) = _subscribe();
        _warpInterval();
        vm.expectEmit(true, true, true, true);
        emit Executed(id, subscriber, address(service), AMOUNT, block.timestamp);
        _execute(id);
    }

    function test_execute_multipleSequentialExecutions() public {
        (bytes32 id, ) = _subscribe();
        for (uint256 i = 1; i <= 5; i++) {
            _warpInterval();
            _execute(id);
            assertEq(subs.getSubscription(id).lastExecutionTime, block.timestamp);
        }
        assertEq(token.balanceOf(address(service)), AMOUNT * 5);
    }

    // ── Reentrancy ────────────────────────────────────────────────────────────

    function test_execute_blocksReentrantCallFromService() public {
        (bytes32 id, ) = _subscribe();
        service.setReentrant(address(subs), id, "");
        _warpInterval();
        vm.prank(executor);
        vm.expectRevert();
        subs.execute(id, "");
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    function test_getSubscription_returnsFullStruct() public {
        (bytes32 id, ) = _subscribe();
        Subscription memory sub = subs.getSubscription(id);
        assertEq(sub.subscriber,     subscriber);
        assertEq(sub.service,        address(service));
        assertEq(sub.spendToken,     address(token));
        assertEq(sub.amountPerCycle, AMOUNT);
    }

    function test_isExecutor_returnsCorrectly() public view {
        assertTrue(subs.isExecutor(executor));
        assertFalse(subs.isExecutor(stranger));
    }

    function test_isServiceRegistered_returnsCorrectly() public view {
        assertTrue(subs.isServiceRegistered(address(service)));
        assertFalse(subs.isServiceRegistered(stranger));
    }
}
