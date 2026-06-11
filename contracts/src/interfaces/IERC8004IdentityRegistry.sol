// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC8004IdentityRegistry {
    /// @notice Emitted when a new agent NFT is minted.
    event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentCardURI);

    /// @notice Mint a new agent identity NFT for the caller.
    /// @param agentCardURI URL to the agent's .well-known/agent.json AgentCard.
    /// @return agentId     Token ID of the minted NFT.
    function register(string calldata agentCardURI) external returns (uint256 agentId);

    /// @notice Returns the AgentCard URI for an existing agent NFT.
    function agentCardURI(uint256 agentId) external view returns (string memory);
}
