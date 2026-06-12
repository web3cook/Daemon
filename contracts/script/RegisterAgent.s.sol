// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC8004IdentityRegistry}   from "../src/ERC8004IdentityRegistry.sol";
import {ERC8004ValidationRegistry} from "../src/ERC8004ValidationRegistry.sol";

// ─────────────────────────────────────────────────────────────────────────────
// RegisterAgent — registers an additional ERC-8004 agent identity against the
// already-deployed registries from DeployTestnet.s.sol, and sets its trust score.
//
// Env vars:
//   AGENT_CARD_URI   — URL to the new agent's .well-known/agent.json
//   AGENT_TRUST_SCORE (optional, default 80)
//
// Run:
//   forge script script/RegisterAgent.s.sol \
//     --rpc-url arbitrum_sepolia \
//     --broadcast -vvv
// ─────────────────────────────────────────────────────────────────────────────

contract RegisterAgent is Script {
    function run() external {
        string memory json = vm.readFile("./deployments/arbitrum-sepolia.json");
        address identityRegistryAddr   = vm.parseJsonAddress(json, ".identityRegistry");
        address validationRegistryAddr = vm.parseJsonAddress(json, ".validationRegistry");

        string memory agentCardURI = vm.envString("AGENT_CARD_URI");
        uint256 trustScore         = vm.envOr("AGENT_TRUST_SCORE", uint256(80));

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("=== RegisterAgent: Arbitrum Sepolia ===");
        console.log("Owner / Validator:", deployer);
        console.log("IdentityRegistry: ", identityRegistryAddr);
        console.log("AgentCard URI:    ", agentCardURI);

        vm.startBroadcast(deployerKey);

        uint256 agentId = ERC8004IdentityRegistry(identityRegistryAddr).register(agentCardURI);
        console.log("Agent registered. agentId:", agentId);

        ERC8004ValidationRegistry(validationRegistryAddr).setScore(agentId, trustScore);
        console.log("Trust score set:", trustScore);

        vm.stopBroadcast();
    }
}
