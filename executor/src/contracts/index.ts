import SubscriptionsABI from './abis/Subscriptions.json' with { type: 'json' }
import ValidationRegistryABI from './abis/ValidationRegistry.json' with { type: 'json' }
import ServiceFactoryABI from './abis/ServiceFactory.json' with { type: 'json' }
import ServiceABI from './abis/Service.json' with { type: 'json' }
import IdentityRegistryABI from './abis/IdentityRegistry.json' with { type: 'json' }

// TestAggregator.swap() — only the one function the agent needs to encode calldata for
export const TestAggregatorSwapABI = [{
  name: 'swap',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spendToken',   type: 'address' },
    { name: 'spendAmount',  type: 'uint256' },
    { name: 'outputToken',  type: 'address' },
    { name: 'outputAmount', type: 'uint256' },
  ],
  outputs: [],
}] as const

export {
  SubscriptionsABI,
  ValidationRegistryABI,
  ServiceFactoryABI,
  ServiceABI,
  IdentityRegistryABI
}
