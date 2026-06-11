// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable}        from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IService}        from "./interfaces/IService.sol";

struct SwapParams {
    address outputToken;
    uint256 minOutputAmount;
    bytes   swapData;
}

contract SIPService is IService, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    address public immutable subscriptions;
    uint256 public immutable MAX_FEE;
    address public aggregator;
    address public treasury;
    uint256 public fee;
    uint256 public maxFeeAmount;
    mapping(address => bool) public outputTokens;

    event FeeUpdated(uint256 indexed old, uint256 indexed newFee);
    event MaxFeeAmountUpdated(uint256 indexed old, uint256 indexed newMax);
    event AggregatorUpdated(address indexed oldAggregator, address indexed newAggregator);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event SwapExecuted(address indexed subscriber, address indexed spendToken, address indexed outputToken, uint256 amountSpent, uint256 amountReceived, uint256 fee);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event Swept(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error NotSubscriptions();
    error SlippageExceeded(uint256 received, uint256 minimum);
    error TokenNotWhitelisted(address token);
    error TokenAlreadyWhitelisted(address token);
    error SwapFailed();
    error FeeTooHigh(uint256 given, uint256 max);

    modifier onlySubscriptions() {
        if (msg.sender != subscriptions) revert NotSubscriptions();
        _;
    }

    constructor(address _subscriptions, address _treasury, uint256 _maxFee, address _aggregator) Ownable(msg.sender) {
        if (_subscriptions == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_aggregator == address(0)) revert ZeroAddress();

        subscriptions = _subscriptions;
        treasury      = _treasury;
        MAX_FEE       = _maxFee;
        aggregator    = _aggregator;
    }

    function setFee(uint256 _newFee) external onlyOwner {
        if (_newFee > MAX_FEE) revert FeeTooHigh(_newFee, MAX_FEE);
        emit FeeUpdated(fee, _newFee);
        fee = _newFee;
    }

    function setMaxFeeAmount(uint256 _maxFeeAmount) external onlyOwner {
        emit MaxFeeAmountUpdated(maxFeeAmount, _maxFeeAmount);
        maxFeeAmount = _maxFeeAmount;
    }

    function setAggregator(address _newAggregator) external onlyOwner {
        if (_newAggregator == address(0)) revert ZeroAddress();
        emit AggregatorUpdated(aggregator, _newAggregator);
        aggregator = _newAggregator;
    }

    function addToken(address _token) external onlyOwner {
        if (_token == address(0)) revert ZeroAddress();
        if (outputTokens[_token]) revert TokenAlreadyWhitelisted(_token);
        outputTokens[_token] = true;
        emit TokenAdded(_token);
    }

    function removeToken(address _token) external onlyOwner {
        if (!outputTokens[_token]) revert TokenNotWhitelisted(_token);
        outputTokens[_token] = false;
        emit TokenRemoved(_token);
    }

    function setTreasury(address _newTreasury) external onlyOwner {
        if (_newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, _newTreasury);
        treasury = _newTreasury;
    }

    function sweep(address _token, address _to) external onlyOwner nonReentrant {
        if (_to == address(0)) revert ZeroAddress();
        uint256 balance = IERC20(_token).balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();
        IERC20(_token).safeTransfer(_to, balance);
        emit Swept(_token, _to, balance);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function execute(
        address        subscriber,
        address        spendToken,
        uint256        amount,
        bytes calldata params
    ) external onlySubscriptions nonReentrant whenNotPaused returns (bool) {
        if (amount == 0) revert ZeroAmount();

        SwapParams memory p = abi.decode(params, (SwapParams));
        if (!outputTokens[p.outputToken]) revert TokenNotWhitelisted(p.outputToken);
        if (p.minOutputAmount == 0) revert ZeroAmount();

        uint256 feeAmount = amount * fee / 10_000;
        if (maxFeeAmount > 0 && feeAmount > maxFeeAmount) {
            feeAmount = maxFeeAmount;
        }
        uint256 swapAmount = amount - feeAmount;
        if (feeAmount > 0) {
            IERC20(spendToken).safeTransfer(treasury, feeAmount);
        }

        uint256 balanceBefore = IERC20(p.outputToken).balanceOf(address(this));

        IERC20(spendToken).forceApprove(aggregator, swapAmount);
        (bool success, ) = aggregator.call(p.swapData);
        if (!success) revert SwapFailed();
        IERC20(spendToken).forceApprove(aggregator, 0);

        uint256 received = IERC20(p.outputToken).balanceOf(address(this)) - balanceBefore;
        if (received < p.minOutputAmount) revert SlippageExceeded(received, p.minOutputAmount);

        emit SwapExecuted(subscriber, spendToken, p.outputToken, amount, received, feeAmount);

        IERC20(p.outputToken).safeTransfer(subscriber, received);

        return true;
    }
}