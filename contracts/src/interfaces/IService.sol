// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IService {
    /// @notice Execute a single DCA cycle for a subscriber.
    /// @param subscriber Recipient of the output tokens.
    /// @param spendToken Input token transferred to this contract before this call.
    /// @param amount     Amount of spendToken available for the swap.
    /// @param params     Implementation-specific swap parameters (ABI-encoded).
    /// @return           True on success; revert on any failure.
    function execute(
        address        subscriber,
        address        spendToken,
        uint256        amount,
        bytes calldata params
    ) external returns (bool);
}
