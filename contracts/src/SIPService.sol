// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable}        from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable2Step}    from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IService}        from "./interfaces/IService.sol";

struct SwapParams {
    address outputToken;
    uint256 minOutputAmount;
    bytes   swapData;
}

error ZeroAddress();
error ZeroAmount();
error NotSubscriptions();
error TokenNotWhitelisted(address token);
error TokenAlreadyWhitelisted(address token);
error SlippageExceeded(uint256 received, uint256 minimum);
error SwapFailed();
error FeeTooHigh(uint256 given, uint256 max);

contract SIPService is IService, Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    address public immutable subscriptions;
    uint256 public immutable MAX_FEE_BPS;

    address public aggregator;
    address public treasury;
    uint256 public feeBps;

    mapping(address => bool) public outputTokens;

    event SwapExecuted(
        address indexed subscriber,
        address indexed outputToken,
        uint256 amountSpent,
        uint256 amountReceived,
        uint256 feeCharged
    );
    event FeeUpdated(uint256 oldBps, uint256 newBps);
    event AggregatorUpdated(address oldAggregator, address newAggregator);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event Swept(address indexed token, address indexed to, uint256 amount);

    modifier onlySubscriptions() {
        if (msg.sender != subscriptions) revert NotSubscriptions();
        _;
    }

    constructor(
        address _subscriptions,
        address _treasury,
        address _aggregator,
        uint256 _maxFeeBps
    ) Ownable(msg.sender) {
        if (_subscriptions == address(0)) revert ZeroAddress();
        if (_treasury      == address(0)) revert ZeroAddress();
        if (_aggregator    == address(0)) revert ZeroAddress();

        subscriptions = _subscriptions;
        treasury      = _treasury;
        aggregator    = _aggregator;
        MAX_FEE_BPS   = _maxFeeBps;
    }

    /// @notice Execute a DCA swap on behalf of a subscriber. Called only by Subscriptions.
    /// @param subscriber Recipient of the output tokens after the swap.
    /// @param spendToken Input token already transferred to this contract by Subscriptions.
    /// @param amount     Amount of spendToken available; protocol fee is deducted before swap.
    /// @param params     ABI-encoded SwapParams: outputToken, minOutputAmount, swapData.
    function execute(
        address        subscriber,
        address        spendToken,
        uint256        amount,
        bytes calldata params
    ) external onlySubscriptions nonReentrant whenNotPaused returns (bool) {
        if (amount == 0) revert ZeroAmount();

        SwapParams memory p = abi.decode(params, (SwapParams));
        if (!outputTokens[p.outputToken]) revert TokenNotWhitelisted(p.outputToken);
        if (p.minOutputAmount == 0)       revert ZeroAmount();

        uint256 feeAmount  = feeBps > 0 ? (amount * feeBps / 10_000) : 0;
        uint256 swapAmount = amount - feeAmount;

        if (feeAmount > 0) {
            IERC20(spendToken).safeTransfer(treasury, feeAmount);
        }

        uint256 balanceBefore = IERC20(p.outputToken).balanceOf(address(this));

        // Approve → swap → reset approval; approval scoped tightly to this call
        IERC20(spendToken).forceApprove(aggregator, swapAmount);
        (bool success, ) = aggregator.call(p.swapData);
        if (!success) revert SwapFailed();
        IERC20(spendToken).forceApprove(aggregator, 0);

        uint256 received = IERC20(p.outputToken).balanceOf(address(this)) - balanceBefore;
        if (received < p.minOutputAmount) revert SlippageExceeded(received, p.minOutputAmount);

        IERC20(p.outputToken).safeTransfer(subscriber, received);

        emit SwapExecuted(subscriber, p.outputToken, amount, received, feeAmount);

        return true;
    }

    /// @notice Update the protocol fee in basis points. Cannot exceed MAX_FEE_BPS.
    function setFee(uint256 _newBps) external onlyOwner {
        if (_newBps > MAX_FEE_BPS) revert FeeTooHigh(_newBps, MAX_FEE_BPS);
        emit FeeUpdated(feeBps, _newBps);
        feeBps = _newBps;
    }

    /// @notice Replace the DEX aggregator that receives swap calldata.
    function setAggregator(address _new) external onlyOwner {
        if (_new == address(0)) revert ZeroAddress();
        emit AggregatorUpdated(aggregator, _new);
        aggregator = _new;
    }

    /// @notice Update the treasury address that receives protocol fees.
    function setTreasury(address _new) external onlyOwner {
        if (_new == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, _new);
        treasury = _new;
    }

    /// @notice Add a token to the output-token whitelist.
    function addToken(address token) external onlyOwner {
        if (token == address(0))  revert ZeroAddress();
        if (outputTokens[token])  revert TokenAlreadyWhitelisted(token);
        outputTokens[token] = true;
        emit TokenAdded(token);
    }

    /// @notice Remove a token from the output-token whitelist.
    function removeToken(address token) external onlyOwner {
        if (!outputTokens[token]) revert TokenNotWhitelisted(token);
        outputTokens[token] = false;
        emit TokenRemoved(token);
    }

    /// @notice Rescue any tokens stuck in this contract.
    function sweep(address token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, bal);
        emit Swept(token, to, bal);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
