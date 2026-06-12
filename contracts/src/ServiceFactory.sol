// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Service}       from "./Service.sol";
import {Subscriptions} from "./Subscriptions.sol";

/// @title ServiceFactory
/// @notice Deploys a dedicated Service contract per agent registration and
///         registers it with the Subscriptions contract. Permissionless: the
///         caller becomes the Service owner (the agent). Requires
///         Subscriptions.setFactory(address(this)) to have been called so the
///         registerService() call succeeds.
contract ServiceFactory {
    address public immutable subscriptions;

    mapping(address => address[]) public servicesByAgent;
    mapping(address => bool)      public isFactoryService;
    address[] public allServices;

    event ServiceCreated(
        address indexed agent,
        address indexed service,
        address indexed spendToken,
        uint256 amount,
        address feeReceiver
    );

    error ZeroAddress();

    constructor(address _subscriptions) {
        if (_subscriptions == address(0)) revert ZeroAddress();
        subscriptions = _subscriptions;
    }

    /// @notice Deploy a Service for the caller and register it with
    ///         Subscriptions so users can subscribe to it immediately.
    /// @param feeReceiver Where the agent's withdrawn earnings are sent.
    /// @param spendToken  Token subscribers pay with (e.g. USDC).
    /// @param amount      Required payment amount per cycle.
    function createService(
        address feeReceiver,
        address spendToken,
        uint256 amount
    ) external returns (address) {
        Service service = new Service(
            msg.sender,
            subscriptions,
            feeReceiver,
            spendToken,
            amount
        );

        Subscriptions(subscriptions).registerService(address(service));

        servicesByAgent[msg.sender].push(address(service));
        isFactoryService[address(service)] = true;
        allServices.push(address(service));

        emit ServiceCreated(msg.sender, address(service), spendToken, amount, feeReceiver);

        return address(service);
    }

    function getServicesByAgent(address agent) external view returns (address[] memory) {
        return servicesByAgent[agent];
    }

    function allServicesLength() external view returns (uint256) {
        return allServices.length;
    }
}
