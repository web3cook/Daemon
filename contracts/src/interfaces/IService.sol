// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IService {
    function execute(
        address        subscriber,
        address        spendToken,
        uint256        amount,
        bytes calldata params
    ) external returns (bool);
}
