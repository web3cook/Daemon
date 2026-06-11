// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable}        from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable2Step}    from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IService}                   from "./interfaces/IService.sol";
import {IPermit2}                   from "./interfaces/IPermit2.sol";
import {IERC8004ValidationRegistry} from "./interfaces/IERC8004ValidationRegistry.sol";

struct Subscription {
    address subscriber;
    uint48  permitExpiry;
    uint48  lastExecutionTime;
    address service;
    uint48  subscriptionStartTime;
    uint32  interval;
    address spendToken;
    uint96  amountPerCycle;
}

error NotExecutor();
error AgentTrustTooLow(uint256 agentId, uint256 score, uint256 required);
error AgentNotMapped(address executor);
error ServiceNotRegistered(address service);
error ServiceAlreadyRegistered(address service);
error PermitAmountTooLow(uint160 given, uint256 required);
error PermitExpired(uint48 expiration);
error PermitSpenderMismatch(address expected, address given);
error PermitTokenMismatch(address expected, address given);
error SubscriptionNotActive(bytes32 id);
error NotSubscriber(bytes32 id);
error TooEarly(bytes32 id, uint256 blockTimestamp);
error InsufficientSubscriptionAmount(bytes32 id, uint256 balance, uint256 required);
error ZeroAmount();
error ZeroInterval();
error ZeroAddress();
error AmountOverflow();
error IntervalOverflow();

event SubscriptionCreated(
    bytes32 indexed id,
    address indexed subscriber,
    address indexed service,
    address spendToken,
    uint96  amountPerCycle,
    uint32  interval,
    uint48  permitExpiry
);
event SubscriptionCancelled(bytes32 indexed id, address indexed subscriber);
event Executed(
    bytes32 indexed id,
    address indexed subscriber,
    address indexed service,
    uint96  amount,
    uint48  executedAt
);
event ExecutorSet(address indexed executor, uint256 agentId, bool enabled);
event ServiceRegistered(address indexed service);
event ServiceRemoved(address indexed service);
event MinTrustScoreUpdated(uint256 oldScore, uint256 newScore);

contract Subscriptions is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IPermit2                   public immutable permit2;
    IERC8004ValidationRegistry public immutable validationRegistry;

    uint256 public minAgentTrustScore;

    mapping(address => bool)         public executors;
    mapping(address => uint256)      public agentIds;
    mapping(address => bool)         public services;
    mapping(bytes32 => Subscription) public subscriptions;
    mapping(address => uint256)      public nonces;

    modifier onlyTrustedAgent() {
        if (!executors[msg.sender]) revert NotExecutor();

        uint256 agentId = agentIds[msg.sender];
        if (agentId == 0) revert AgentNotMapped(msg.sender);

        uint256 score = validationRegistry.getScore(agentId);
        if (score < minAgentTrustScore) revert AgentTrustTooLow(agentId, score, minAgentTrustScore);
        _;
    }

    constructor(
        address _permit2,
        address _validationRegistry,
        address _executor,
        uint256 _executorAgentId,
        uint256 _minAgentTrustScore
    ) Ownable(msg.sender) {
        if (_permit2            == address(0)) revert ZeroAddress();
        if (_validationRegistry == address(0)) revert ZeroAddress();
        if (_executor           == address(0)) revert ZeroAddress();
        if (_executorAgentId    == 0)          revert ZeroAmount();

        permit2            = IPermit2(_permit2);
        validationRegistry = IERC8004ValidationRegistry(_validationRegistry);
        minAgentTrustScore = _minAgentTrustScore;

        executors[_executor] = true;
        agentIds[_executor]  = _executorAgentId;
        emit ExecutorSet(_executor, _executorAgentId, true);
    }

    /// @notice Create a DCA subscription backed by a Permit2 allowance.
    /// @param service        IService implementation that executes swaps each cycle.
    /// @param spendToken     Token pulled from the subscriber each cycle (e.g. USDC).
    /// @param amountPerCycle Spend-token amount per cycle; must fit in uint96.
    /// @param interval       Minimum seconds between executions; must fit in uint32.
    /// @param permitSingle   Permit2 PermitSingle authorising this contract to pull spendToken.
    /// @param signature      EIP-712 signature over permitSingle, signed by msg.sender.
    function subscribe(
        address                        service,
        address                        spendToken,
        uint256                        amountPerCycle,
        uint256                        interval,
        IPermit2.PermitSingle calldata permitSingle,
        bytes                 calldata signature
    ) external whenNotPaused {
        if (!services[service])                                 revert ServiceNotRegistered(service);
        if (amountPerCycle == 0)                                revert ZeroAmount();
        if (amountPerCycle > type(uint96).max)                  revert AmountOverflow();
        if (interval == 0)                                      revert ZeroInterval();
        if (interval > type(uint32).max)                        revert IntervalOverflow();
        if (permitSingle.details.token != spendToken)           revert PermitTokenMismatch(spendToken, permitSingle.details.token);
        if (permitSingle.spender != address(this))              revert PermitSpenderMismatch(address(this), permitSingle.spender);
        if (permitSingle.details.expiration <= block.timestamp) revert PermitExpired(permitSingle.details.expiration);

        uint256 executionCount = (permitSingle.details.expiration - block.timestamp) / interval;
        if (uint256(permitSingle.details.amount) < amountPerCycle * executionCount)
            revert PermitAmountTooLow(permitSingle.details.amount, amountPerCycle * executionCount);

        bytes32 id = keccak256(abi.encode(
            msg.sender,
            service,
            spendToken,
            nonces[msg.sender]++
        ));

        uint96 _amount   = uint96(amountPerCycle);
        uint32 _interval = uint32(interval);
        uint48 _expiry   = permitSingle.details.expiration;
        uint48 _now      = uint48(block.timestamp);

        subscriptions[id] = Subscription({
            subscriber:            msg.sender,
            permitExpiry:          _expiry,
            lastExecutionTime:     _now,
            service:               service,
            subscriptionStartTime: _now,
            interval:              _interval,
            spendToken:            spendToken,
            amountPerCycle:        _amount
        });

        permit2.permit(msg.sender, permitSingle, signature);

        emit SubscriptionCreated(id, msg.sender, service, spendToken, _amount, _interval, _expiry);
    }

    /// @notice Cancel an active subscription, preventing any further executions.
    /// @param id Subscription ID returned by subscribe().
    function cancel(bytes32 id) external {
        Subscription storage sub = subscriptions[id];
        if (sub.subscriber != msg.sender)      revert NotSubscriber(id);
        if (sub.permitExpiry < block.timestamp) revert SubscriptionNotActive(id);

        sub.permitExpiry = uint48(block.timestamp);

        emit SubscriptionCancelled(id, msg.sender);
    }

    /// @notice Execute one DCA cycle. Only callable by a trusted ERC-8004 registered agent.
    /// @param id     Subscription ID.
    /// @param params ABI-encoded SwapParams forwarded verbatim to the IService implementation.
    function execute(bytes32 id, bytes calldata params)
        external
        onlyTrustedAgent
        nonReentrant
        whenNotPaused
    {
        Subscription storage sub = subscriptions[id];

        address _service    = sub.service;           
        uint32  _interval   = sub.interval;          
        address _subscriber = sub.subscriber;        
        uint48  _expiry     = sub.permitExpiry;      
        uint48  _lastExec   = sub.lastExecutionTime; 
        address _spendToken = sub.spendToken;        
        uint96  _amount     = sub.amountPerCycle;    

        if (!services[_service])                                        revert ServiceNotRegistered(_service);
        if (_expiry < block.timestamp)                                  revert SubscriptionNotActive(id);
        if (uint256(_lastExec) + uint256(_interval) > block.timestamp) revert TooEarly(id, block.timestamp);

        uint256 balance = IERC20(_spendToken).balanceOf(_subscriber);
        if (balance < _amount)
            revert InsufficientSubscriptionAmount(id, balance, _amount);

        sub.lastExecutionTime = uint48(block.timestamp);

        permit2.transferFrom(_subscriber, _service, uint160(_amount), _spendToken);
        IService(_service).execute(_subscriber, _spendToken, _amount, params);

        emit Executed(id, _subscriber, _service, _amount, uint48(block.timestamp));
    }

    /// @notice Map or unmap an executor EOA to its ERC-8004 agent identity.
    function setExecutor(address executor, uint256 agentId, bool enabled) external onlyOwner {
        if (executor == address(0)) revert ZeroAddress();
        executors[executor] = enabled;
        agentIds[executor]  = agentId;
        emit ExecutorSet(executor, agentId, enabled);
    }

    /// @notice Update the minimum ERC-8004 trust score required for execute() to succeed.
    function setMinTrustScore(uint256 newScore) external onlyOwner {
        emit MinTrustScoreUpdated(minAgentTrustScore, newScore);
        minAgentTrustScore = newScore;
    }

    /// @notice Whitelist a service contract to receive funds via execute().
    function registerService(address service) external onlyOwner {
        if (service == address(0)) revert ZeroAddress();
        if (services[service])     revert ServiceAlreadyRegistered(service);
        services[service] = true;
        emit ServiceRegistered(service);
    }

    /// @notice Remove a service from the whitelist.
    function removeService(address service) external onlyOwner {
        if (!services[service]) revert ServiceNotRegistered(service);
        services[service] = false;
        emit ServiceRemoved(service);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Returns the full Subscription state for a given ID.
    function getSubscription(bytes32 id) external view returns (Subscription memory) {
        return subscriptions[id];
    }
}
