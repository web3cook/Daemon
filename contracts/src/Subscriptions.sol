// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable}        from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast}        from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IService}        from "./interfaces/IService.sol";
import {IPermit2}        from "./interfaces/IPermit2.sol";

struct Subscription {
    address subscriber;
    uint48  permitExpiry;
    bool    active;
    address service;
    address spendToken;
    uint256 amountPerCycle;
    uint256 interval;
    uint256 nextExecutionAt;
    uint256 maxExecutions;
    uint256 executionsCount;
}

error NotExecutor();
error ServiceNotRegistered(address service);
error ServiceAlreadyRegistered(address service);
error PermitAmountTooLow(uint160 given, uint256 required);
error PermitExpired(uint48 expiration);
error PermitSpenderMismatch(address expected, address given);
error PermitTokenMismatch(address expected, address given);
error SubscriptionNotActive(bytes32 id);
error NotSubscriber(bytes32 id);
error TooEarly(uint256 currentTime, uint256 nextExecutionAt);
error MaxExecutionsReached(bytes32 id);
error ZeroAmount();
error ZeroInterval();
error ZeroAddress();

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
event SubscriptionCancelled(
    bytes32 indexed id,
    address indexed subscriber
);
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

contract Subscriptions is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IPermit2 public immutable permit2;

    mapping(address => bool)         public executors;
    mapping(address => bool)         public services;
    mapping(bytes32 => Subscription) public subscriptions;
    mapping(address => uint256)      public nonces;

    modifier onlyExecutor() {
        if (!executors[msg.sender]) revert NotExecutor();
        _;
    }

    constructor(address _permit2, address _executor) Ownable(msg.sender) {
        if (_permit2  == address(0)) revert ZeroAddress();
        if (_executor == address(0)) revert ZeroAddress();

        permit2              = IPermit2(_permit2);
        executors[_executor] = true;

        emit ExecutorSet(_executor, true);
    }

    function subscribe(
        address                       service,
        address                       spendToken,
        uint256                       amountPerCycle,
        uint256                       interval,
        uint256                       maxExecutions,
        IPermit2.PermitSingle calldata permitSingle,
        bytes                 calldata signature
    ) external whenNotPaused {
        if (!services[service]) revert ServiceNotRegistered(service);
        if (amountPerCycle == 0) revert ZeroAmount();
        if (amountPerCycle > type(uint160).max) revert PermitAmountTooLow(0, amountPerCycle);
        if (interval == 0) revert ZeroInterval();
        if (permitSingle.details.token != spendToken) revert PermitTokenMismatch(spendToken, permitSingle.details.token);
        if (permitSingle.spender != address(this)) revert PermitSpenderMismatch(address(this), permitSingle.spender);
        if (maxExecutions == 0) {
            if (permitSingle.details.amount != type(uint160).max)
              revert PermitAmountTooLow(permitSingle.details.amount, uint256(type(uint160).max));
        } else {
            if (uint256(permitSingle.details.amount) < amountPerCycle * maxExecutions)
              revert PermitAmountTooLow(permitSingle.details.amount, amountPerCycle * maxExecutions);
        }
        if (permitSingle.details.expiration <= block.timestamp) revert PermitExpired(permitSingle.details.expiration);

        bytes32 id = keccak256(abi.encode(
            msg.sender,
            service,
            spendToken,
            nonces[msg.sender]++
        ));

        subscriptions[id] = Subscription({
            subscriber:      msg.sender,
            permitExpiry:    permitSingle.details.expiration,
            active:          true,
            service:         service,
            spendToken:      spendToken,
            amountPerCycle:  amountPerCycle,
            interval:        interval,
            nextExecutionAt: block.timestamp,
            maxExecutions:   maxExecutions,
            executionsCount: 0
        });

        permit2.permit(msg.sender, permitSingle, signature);

        emit SubscriptionCreated(
            id,
            msg.sender,
            service,
            spendToken,
            amountPerCycle,
            interval,
            maxExecutions,
            permitSingle.details.expiration
        );
    }

    function cancel(bytes32 id) external {
        Subscription storage sub = subscriptions[id];
        if (sub.subscriber != msg.sender) revert NotSubscriber(id);
        if (!sub.active)                  revert SubscriptionNotActive(id);

        sub.active = false;

        emit SubscriptionCancelled(id, msg.sender);
    }

    function execute(bytes32 id, bytes calldata params)
        external
        onlyExecutor
        nonReentrant
        whenNotPaused
    {
        Subscription storage sub = subscriptions[id];

        if (!services[sub.service]) revert ServiceNotRegistered(sub.service);
        if (!sub.active) revert SubscriptionNotActive(id);
        if (block.timestamp < sub.nextExecutionAt) revert TooEarly(block.timestamp, sub.nextExecutionAt);
        if (block.timestamp > sub.permitExpiry) revert PermitExpired(sub.permitExpiry);
        if (sub.maxExecutions != 0 && sub.executionsCount >= sub.maxExecutions) revert MaxExecutionsReached(id);

        sub.executionsCount++;
        sub.nextExecutionAt = block.timestamp + sub.interval;

        if (sub.maxExecutions != 0 && sub.executionsCount >= sub.maxExecutions) {
            sub.active = false;
        }

        permit2.transferFrom(
            sub.subscriber,
            sub.service,
            SafeCast.toUint160(sub.amountPerCycle),
            sub.spendToken
        );

        IService(sub.service).execute(
            sub.subscriber,
            sub.spendToken,
            sub.amountPerCycle,
            params
        );

        emit Executed(
            id,
            sub.subscriber,
            sub.amountPerCycle,
            sub.executionsCount,
            sub.nextExecutionAt
        );
    }

    function setExecutor(address executor, bool enabled) external onlyOwner {
        if (executor == address(0)) revert ZeroAddress();
        executors[executor] = enabled;
        emit ExecutorSet(executor, enabled);
    }

    function registerService(address service) external onlyOwner {
        if (service == address(0)) revert ZeroAddress();
        if (services[service])     revert ServiceAlreadyRegistered(service);
        services[service] = true;
        emit ServiceRegistered(service);
    }

    function removeService(address service) external onlyOwner {
        if (!services[service]) revert ServiceNotRegistered(service);
        services[service] = false;
        emit ServiceRemoved(service);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function getSubscription(bytes32 id) external view returns (Subscription memory) {
        return subscriptions[id];
    }

    function isExecutor(address account) external view returns (bool) {
        return executors[account];
    }

    function isServiceRegistered(address service) external view returns (bool) {
        return services[service];
    }
}
