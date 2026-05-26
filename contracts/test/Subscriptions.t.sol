// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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
    MaxExecutionsReached,
    ZeroAmount,
    ZeroInterval,
    ZeroAddress
} from "../src/Subscriptions.sol";
import {IPermit2}  from "../src/interfaces/IPermit2.sol";
import {IService}  from "../src/interfaces/IService.sol";

// ── Events (file-level in Subscriptions.sol, redeclared here for vm.expectEmit) ──

event SubscriptionCreated(
    bytes32 indexed id,
    address indexed subscriber,
    address indexed service,
    address spendToken,
    uint256 amountPerCycle,
    uint256 interval,
    uint256 maxExecutions,
    uint48  permitExpiry
);
event SubscriptionCancelled(bytes32 indexed id, address indexed subscriber);
event Executed(
    bytes32 indexed id,
    address indexed subscriber,
    uint256 amountSpent,
    uint256 executionsCount,
    uint256 nextExecutionAt
);
event ExecutorSet(address indexed executor, bool enabled);
event ServiceRegistered(address indexed service);
event ServiceRemoved(address indexed service);

// ── Mocks ────────────────────────────────────────────────────────────────────

contract MockPermit2 {
    address public lastPermitOwner;
    address public lastTransferFrom;
    address public lastTransferTo;
    uint160 public lastTransferAmount;
    address public lastTransferToken;

    function permit(
        address owner,
        IPermit2.PermitSingle calldata,
        bytes calldata
    ) external {
        lastPermitOwner = owner;
    }

    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address tkn
    ) external {
        lastTransferFrom   = from;
        lastTransferTo     = to;
        lastTransferAmount = amount;
        lastTransferToken  = tkn;
    }
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

contract SubscriptionsTest is Test {
    Subscriptions subs;
    MockPermit2   permit2Mock;
    MockService   service;

    address owner      = makeAddr("owner");
    address executor   = makeAddr("executor");
    address subscriber = makeAddr("subscriber");
    address token      = makeAddr("token");
    address stranger   = makeAddr("stranger");

    uint256 constant AMOUNT   = 100e6;
    uint256 constant INTERVAL = 1 days;
    uint256 constant MAX_EXEC = 10;
    uint48  constant EXPIRY   = type(uint48).max;

    // ── Helpers ──────────────────────────────────────────────────────────────

    function _permit(uint256 maxExec) internal view returns (IPermit2.PermitSingle memory) {
        uint160 permitAmount = maxExec == 0
            ? type(uint160).max
            : uint160(AMOUNT * maxExec);
        return IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token:      token,
                amount:     permitAmount,
                expiration: EXPIRY,
                nonce:      0
            }),
            spender:     address(subs),
            sigDeadline: block.timestamp + 1 days
        });
    }

    // Computes the expected ID from the current nonce, then calls subscribe.
    function _subscribe(uint256 maxExec) internal returns (bytes32 id) {
        id = keccak256(abi.encode(subscriber, address(service), token, subs.nonces(subscriber)));
        vm.prank(subscriber);
        subs.subscribe(address(service), token, AMOUNT, INTERVAL, maxExec, _permit(maxExec), "");
    }

    function _execute(bytes32 id) internal {
        vm.prank(executor);
        subs.execute(id, "");
    }

    // ── Setup ────────────────────────────────────────────────────────────────

    function setUp() public {
        permit2Mock = new MockPermit2();
        service     = new MockService();

        vm.prank(owner);
        subs = new Subscriptions(address(permit2Mock), executor);

        vm.prank(owner);
        subs.registerService(address(service));
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    function test_constructor_revertsOnZeroPermit2() public {
        vm.expectRevert(ZeroAddress.selector);
        new Subscriptions(address(0), executor);
    }

    function test_constructor_revertsOnZeroExecutor() public {
        vm.expectRevert(ZeroAddress.selector);
        new Subscriptions(address(permit2Mock), address(0));
    }

    function test_constructor_setsPermit2() public view {
        assertEq(address(subs.permit2()), address(permit2Mock));
    }

    function test_constructor_setsExecutor() public view {
        assertTrue(subs.isExecutor(executor));
    }

    function test_constructor_emitsExecutorSet() public {
        vm.expectEmit(true, false, false, true);
        emit ExecutorSet(executor, true);
        new Subscriptions(address(permit2Mock), executor);
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
        vm.prank(subscriber);
        vm.expectRevert();
        subs.subscribe(address(service), token, AMOUNT, INTERVAL, MAX_EXEC, _permit(MAX_EXEC), "");
    }

    function test_execute_revertsWhenPaused() public {
        bytes32 id = _subscribe(MAX_EXEC);
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
        bytes32 id = _subscribe(MAX_EXEC);
        assertTrue(subs.getSubscription(id).active);
    }

    // ── subscribe() — validation ─────────────────────────────────────────────

    function test_subscribe_revertsServiceNotRegistered() public {
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(ServiceNotRegistered.selector, stranger));
        subs.subscribe(stranger, token, AMOUNT, INTERVAL, MAX_EXEC, _permit(MAX_EXEC), "");
    }

    function test_subscribe_revertsZeroAmount() public {
        vm.prank(subscriber);
        vm.expectRevert(ZeroAmount.selector);
        subs.subscribe(address(service), token, 0, INTERVAL, MAX_EXEC, _permit(MAX_EXEC), "");
    }

    function test_subscribe_revertsAmountAboveUint160Max() public {
        uint256 tooBig = uint256(type(uint160).max) + 1;
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitAmountTooLow.selector, uint160(0), tooBig));
        subs.subscribe(address(service), token, tooBig, INTERVAL, MAX_EXEC, _permit(MAX_EXEC), "");
    }

    function test_subscribe_revertsZeroInterval() public {
        vm.prank(subscriber);
        vm.expectRevert(ZeroInterval.selector);
        subs.subscribe(address(service), token, AMOUNT, 0, MAX_EXEC, _permit(MAX_EXEC), "");
    }

    function test_subscribe_revertsPermitTokenMismatch() public {
        IPermit2.PermitSingle memory p = _permit(MAX_EXEC);
        address wrongToken = makeAddr("wrongToken");
        p.details.token = wrongToken;
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitTokenMismatch.selector, token, wrongToken));
        subs.subscribe(address(service), token, AMOUNT, INTERVAL, MAX_EXEC, p, "");
    }

    function test_subscribe_revertsPermitSpenderMismatch() public {
        IPermit2.PermitSingle memory p = _permit(MAX_EXEC);
        p.spender = stranger;
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitSpenderMismatch.selector, address(subs), stranger));
        subs.subscribe(address(service), token, AMOUNT, INTERVAL, MAX_EXEC, p, "");
    }

    function test_subscribe_revertsUnlimitedPermitNotMax() public {
        // maxExecutions == 0 requires permit amount == type(uint160).max
        IPermit2.PermitSingle memory p = _permit(0);
        p.details.amount = uint160(AMOUNT); // less than max
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitAmountTooLow.selector, p.details.amount, uint256(type(uint160).max)));
        subs.subscribe(address(service), token, AMOUNT, INTERVAL, 0, p, "");
    }

    function test_subscribe_revertsPermitAmountTooLow_bounded() public {
        IPermit2.PermitSingle memory p = _permit(MAX_EXEC);
        p.details.amount = uint160(AMOUNT * MAX_EXEC) - 1;
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitAmountTooLow.selector, p.details.amount, AMOUNT * MAX_EXEC));
        subs.subscribe(address(service), token, AMOUNT, INTERVAL, MAX_EXEC, p, "");
    }

    function test_subscribe_revertsPermitExpiredAtCurrentTimestamp() public {
        IPermit2.PermitSingle memory p = _permit(MAX_EXEC);
        p.details.expiration = uint48(block.timestamp); // not strictly greater
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PermitExpired.selector, p.details.expiration));
        subs.subscribe(address(service), token, AMOUNT, INTERVAL, MAX_EXEC, p, "");
    }

    // ── subscribe() — happy path ─────────────────────────────────────────────

    function test_subscribe_storesCorrectState() public {
        uint256 ts = block.timestamp;
        bytes32 id = _subscribe(MAX_EXEC);

        Subscription memory sub = subs.getSubscription(id);
        assertEq(sub.subscriber,      subscriber);
        assertEq(sub.service,         address(service));
        assertEq(sub.spendToken,      token);
        assertEq(sub.amountPerCycle,  AMOUNT);
        assertEq(sub.interval,        INTERVAL);
        assertEq(sub.maxExecutions,   MAX_EXEC);
        assertEq(sub.executionsCount, 0);
        assertEq(sub.nextExecutionAt, ts);
        assertEq(sub.permitExpiry,    EXPIRY);
        assertTrue(sub.active);
    }

    function test_subscribe_nextExecutionAtEqualsBlockTimestamp() public {
        vm.warp(1_700_000_000);
        bytes32 id = _subscribe(MAX_EXEC);
        assertEq(subs.getSubscription(id).nextExecutionAt, 1_700_000_000);
    }

    function test_subscribe_incrementsNonce() public {
        assertEq(subs.nonces(subscriber), 0);
        _subscribe(MAX_EXEC);
        assertEq(subs.nonces(subscriber), 1);
        _subscribe(MAX_EXEC);
        assertEq(subs.nonces(subscriber), 2);
    }

    function test_subscribe_idDeterministic() public {
        uint256 nonce      = subs.nonces(subscriber);
        bytes32 expectedId = keccak256(abi.encode(subscriber, address(service), token, nonce));
        bytes32 actualId   = _subscribe(MAX_EXEC);
        assertEq(actualId, expectedId);
    }

    function test_subscribe_twoSubsProduceDifferentIds() public {
        bytes32 id1 = _subscribe(MAX_EXEC);
        bytes32 id2 = _subscribe(MAX_EXEC);
        assertTrue(id1 != id2);
    }

    function test_subscribe_callsPermit2WithSubscriberAsOwner() public {
        _subscribe(MAX_EXEC);
        assertEq(permit2Mock.lastPermitOwner(), subscriber);
    }

    function test_subscribe_emitsSubscriptionCreated() public {
        uint256 nonce      = subs.nonces(subscriber);
        bytes32 expectedId = keccak256(abi.encode(subscriber, address(service), token, nonce));

        vm.expectEmit(true, true, true, true);
        emit SubscriptionCreated(expectedId, subscriber, address(service), token, AMOUNT, INTERVAL, MAX_EXEC, EXPIRY);
        vm.prank(subscriber);
        subs.subscribe(address(service), token, AMOUNT, INTERVAL, MAX_EXEC, _permit(MAX_EXEC), "");
    }

    function test_subscribe_unlimitedAcceptsMaxUint160() public {
        bytes32 id = _subscribe(0);
        assertEq(subs.getSubscription(id).maxExecutions, 0);
        assertTrue(subs.getSubscription(id).active);
    }

    // ── cancel() ─────────────────────────────────────────────────────────────

    function test_cancel_revertsIfNotSubscriber() public {
        bytes32 id = _subscribe(MAX_EXEC);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(NotSubscriber.selector, id));
        subs.cancel(id);
    }

    function test_cancel_revertsIfOwnerTriesToCancel() public {
        bytes32 id = _subscribe(MAX_EXEC);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(NotSubscriber.selector, id));
        subs.cancel(id);
    }

    function test_cancel_revertsIfExecutorTriesToCancel() public {
        bytes32 id = _subscribe(MAX_EXEC);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(NotSubscriber.selector, id));
        subs.cancel(id);
    }

    function test_cancel_revertsIfAlreadyCancelled() public {
        bytes32 id = _subscribe(MAX_EXEC);
        vm.prank(subscriber);
        subs.cancel(id);
        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionNotActive.selector, id));
        subs.cancel(id);
    }

    function test_cancel_setsActiveFalse() public {
        bytes32 id = _subscribe(MAX_EXEC);
        vm.prank(subscriber);
        subs.cancel(id);
        assertFalse(subs.getSubscription(id).active);
    }

    function test_cancel_emitsSubscriptionCancelled() public {
        bytes32 id = _subscribe(MAX_EXEC);
        vm.expectEmit(true, true, false, false);
        emit SubscriptionCancelled(id, subscriber);
        vm.prank(subscriber);
        subs.cancel(id);
    }

    // ── execute() — validation ───────────────────────────────────────────────

    function test_execute_revertsIfNotExecutor() public {
        bytes32 id = _subscribe(MAX_EXEC);
        vm.prank(stranger);
        vm.expectRevert(NotExecutor.selector);
        subs.execute(id, "");
    }

    function test_execute_revertsIfServiceRemovedAfterSubscription() public {
        bytes32 id = _subscribe(MAX_EXEC);
        vm.prank(owner);
        subs.removeService(address(service));
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(ServiceNotRegistered.selector, address(service)));
        subs.execute(id, "");
    }

    function test_execute_revertsIfNotActive() public {
        bytes32 id = _subscribe(MAX_EXEC);
        vm.prank(subscriber);
        subs.cancel(id);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionNotActive.selector, id));
        subs.execute(id, "");
    }

    function test_execute_revertsTooEarly() public {
        bytes32 id = _subscribe(MAX_EXEC);
        _execute(id); // nextExecutionAt = T + INTERVAL
        vm.warp(block.timestamp + INTERVAL - 1); // one second short
        vm.prank(executor);
        vm.expectRevert();
        subs.execute(id, "");
    }

    function test_execute_revertsPermitExpired() public {
        vm.warp(1_000_000);
        uint48 shortExpiry = uint48(block.timestamp + 1 hours);

        IPermit2.PermitSingle memory p = _permit(MAX_EXEC);
        p.details.expiration = shortExpiry;
        bytes32 id = keccak256(abi.encode(subscriber, address(service), token, 0));
        vm.prank(subscriber);
        subs.subscribe(address(service), token, AMOUNT, INTERVAL, MAX_EXEC, p, "");

        vm.warp(uint256(shortExpiry) + 1);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(PermitExpired.selector, shortExpiry));
        subs.execute(id, "");
    }

    function test_execute_revertsMaxExecutionsReached() public {
        bytes32 id = _subscribe(1);
        _execute(id); // auto-cancels after this
        vm.warp(block.timestamp + INTERVAL);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionNotActive.selector, id));
        subs.execute(id, "");
    }

    // ── execute() — happy path ────────────────────────────────────────────────

    function test_execute_callsPermit2TransferFrom() public {
        bytes32 id = _subscribe(MAX_EXEC);
        _execute(id);
        assertEq(permit2Mock.lastTransferFrom(),   subscriber);
        assertEq(permit2Mock.lastTransferTo(),     address(service));
        assertEq(permit2Mock.lastTransferAmount(), uint160(AMOUNT));
        assertEq(permit2Mock.lastTransferToken(),  token);
    }

    function test_execute_callsServiceExecute() public {
        bytes32 id = _subscribe(MAX_EXEC);
        bytes memory params = abi.encode(uint256(42));
        vm.prank(executor);
        subs.execute(id, params);
        assertEq(service.lastSubscriber(), subscriber);
        assertEq(service.lastSpendToken(), token);
        assertEq(service.lastAmount(),     AMOUNT);
        assertEq(service.lastParams(),     params);
    }

    function test_execute_incrementsExecutionsCount() public {
        bytes32 id = _subscribe(MAX_EXEC);
        _execute(id);
        assertEq(subs.getSubscription(id).executionsCount, 1);
    }

    function test_execute_updatesNextExecutionAt() public {
        vm.warp(1_700_000_000);
        bytes32 id = _subscribe(MAX_EXEC);
        _execute(id);
        assertEq(subs.getSubscription(id).nextExecutionAt, 1_700_000_000 + INTERVAL);
    }

    function test_execute_succeedsExactlyAtNextExecutionAt() public {
        bytes32 id = _subscribe(MAX_EXEC);
        _execute(id);
        vm.warp(subs.getSubscription(id).nextExecutionAt); // exact boundary
        _execute(id);
        assertEq(subs.getSubscription(id).executionsCount, 2);
    }

    function test_execute_emitsExecuted() public {
        bytes32 id = _subscribe(MAX_EXEC);
        vm.expectEmit(true, true, false, true);
        emit Executed(id, subscriber, AMOUNT, 1, block.timestamp + INTERVAL);
        _execute(id);
    }

    function test_execute_multipleSequentialExecutions() public {
        bytes32 id = _subscribe(MAX_EXEC);
        for (uint256 i = 1; i <= 5; i++) {
            _execute(id);
            assertEq(subs.getSubscription(id).executionsCount, i);
            vm.warp(block.timestamp + INTERVAL);
        }
        assertTrue(subs.getSubscription(id).active);
    }

    function test_execute_unlimitedNeverAutoCancels() public {
        bytes32 id = _subscribe(0);
        for (uint256 i = 0; i < 20; i++) {
            _execute(id);
            vm.warp(block.timestamp + INTERVAL);
        }
        assertTrue(subs.getSubscription(id).active);
        assertEq(subs.getSubscription(id).executionsCount, 20);
    }

    // ── Auto-cancel on maxExecutions ─────────────────────────────────────────

    function test_execute_autoCancelsOnFinalExecution() public {
        bytes32 id = _subscribe(3);
        for (uint256 i = 0; i < 2; i++) {
            _execute(id);
            vm.warp(block.timestamp + INTERVAL);
        }
        assertTrue(subs.getSubscription(id).active);

        _execute(id); // 3rd = final
        assertFalse(subs.getSubscription(id).active);
        assertEq(subs.getSubscription(id).executionsCount, 3);
    }

    function test_execute_revertsAfterAutoCancel() public {
        bytes32 id = _subscribe(1);
        _execute(id);
        vm.warp(block.timestamp + INTERVAL);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionNotActive.selector, id));
        subs.execute(id, "");
    }

    function test_execute_finalExecutionEmitsExecutedBeforeCancel() public {
        bytes32 id = _subscribe(1);
        // Emitted event must reflect executionsCount = 1, not 0
        vm.expectEmit(true, true, false, true);
        emit Executed(id, subscriber, AMOUNT, 1, block.timestamp + INTERVAL);
        _execute(id);
        assertFalse(subs.getSubscription(id).active);
    }

    // ── Reentrancy ────────────────────────────────────────────────────────────

    function test_execute_blocksReentrantCallFromService() public {
        bytes32 id = _subscribe(MAX_EXEC);
        service.setReentrant(address(subs), id, "");
        vm.prank(executor);
        vm.expectRevert();
        subs.execute(id, "");
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    function test_getSubscription_returnsFullStruct() public {
        bytes32 id  = _subscribe(MAX_EXEC);
        Subscription memory sub = subs.getSubscription(id);
        assertEq(sub.subscriber,     subscriber);
        assertEq(sub.service,        address(service));
        assertEq(sub.spendToken,     token);
        assertEq(sub.amountPerCycle, AMOUNT);
        assertTrue(sub.active);
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
