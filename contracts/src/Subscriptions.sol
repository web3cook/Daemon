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
    address service;
    address spendToken;
    uint256 amountPerCycle;
    uint256 interval;
    uint256 lastExecutionTime;
    uint256 subscriptionStartTime;
    uint256 permitExpiry;
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
error TooEarly(bytes32 id, uint256 blockTimeStamp);
error InsufficientSubscriptionAmount(bytes32 id, uint256 balance, uint256 balanceRequired);
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
    uint48  permitExpiry
);
event SubscriptionCancelled(
    bytes32 indexed id,
    address indexed subscriber
);
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

contract Subscriptions is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    IPermit2 public constant permit2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    mapping(address => bool)         public executors;
    mapping(address => bool)         public services;
    mapping(bytes32 => Subscription) public subscriptions;
    mapping(address => uint256)      public nonces;

    modifier onlyExecutor() {
        if (!executors[msg.sender]) revert NotExecutor();
        _;
    }

    constructor(address _executor) Ownable(msg.sender) {
        if (_executor == address(0)) revert ZeroAddress();
        executors[_executor] = true;
        emit ExecutorSet(_executor, true);
    }

    function subscribe(
        address                       service,
        address                       spendToken,
        uint256                       amountPerCycle,
        uint256                       interval,
        IPermit2.PermitSingle calldata permitSingle,
        bytes                 calldata signature
    ) external whenNotPaused {
        if (!services[service]) revert ServiceNotRegistered(service);
        if (amountPerCycle == 0) revert ZeroAmount();
        if (amountPerCycle > type(uint160).max) revert PermitAmountTooLow(0, amountPerCycle);
        if (interval == 0) revert ZeroInterval();
        if (permitSingle.details.token != spendToken) revert PermitTokenMismatch(spendToken, permitSingle.details.token);
        if (permitSingle.spender != address(this)) revert PermitSpenderMismatch(address(this), permitSingle.spender);
        if (permitSingle.details.expiration <= block.timestamp) revert PermitExpired(permitSingle.details.expiration);
        uint256 executionCount = (permitSingle.details.expiration - block.timestamp)/interval;
        if (uint256(permitSingle.details.amount) < amountPerCycle * executionCount)
            revert PermitAmountTooLow(permitSingle.details.amount, amountPerCycle * executionCount);

        bytes32 id = keccak256(abi.encode(
            msg.sender,
            service,
            spendToken,
            nonces[msg.sender]++
        ));

        subscriptions[id] = Subscription({
            subscriber:      msg.sender,
            service:         service,
            spendToken:      spendToken,
            amountPerCycle:  amountPerCycle,
            interval:        interval,
            lastExecutionTime: block.timestamp,
            subscriptionStartTime: block.timestamp,
            permitExpiry: uint256(permitSingle.details.expiration)
        });

        permit2.permit(msg.sender, permitSingle, signature);

        emit SubscriptionCreated(
            id,
            msg.sender,
            service,
            spendToken,
            amountPerCycle,
            interval,
            permitSingle.details.expiration
        );
    }

    function cancel(bytes32 id) external {
        Subscription storage sub = subscriptions[id];
        if (sub.subscriber != msg.sender) revert NotSubscriber(id);
        if (sub.permitExpiry<block.timestamp) revert SubscriptionNotActive(id);

        sub.permitExpiry = block.timestamp;

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
        if (sub.permitExpiry < block.timestamp) revert SubscriptionNotActive(id);
        if (sub.lastExecutionTime + sub.interval > block.timestamp) revert TooEarly(id, block.timestamp);
        uint256 balanceUser = IERC20(sub.spendToken).balanceOf(sub.subscriber);
        if(balanceUser<sub.amountPerCycle) revert InsufficientSubscriptionAmount(id, balanceUser,sub.amountPerCycle);
        sub.lastExecutionTime = block.timestamp;

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
            sub.service,
            sub.amountPerCycle,
            block.timestamp
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
