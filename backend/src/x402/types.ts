// x402 protocol v2, "exact" scheme on EVM (EIP-3009 transferWithAuthorization).
// Verified against the public facilitator at https://facilitator.x402.rs
// (Arbitrum Sepolia is only supported under x402Version 2, network "eip155:421614").

export interface AssetTransferMethod {
  assetTransferMethod: 'eip3009' | 'permit2'
  name:    string // EIP-712 domain name of the asset (e.g. "USD Coin")
  version: string // EIP-712 domain version of the asset (e.g. "2")
}

// Payment terms set by the seller (a.k.a. "accepted" / "paymentRequirements").
export interface PaymentRequirements {
  scheme:            string // "exact"
  network:           string // CAIP-2 chain id, e.g. "eip155:421614"
  amount:            string // USDC amount, smallest unit (6 dec), decimal string
  payTo:             string // checksummed server wallet address
  asset:             string // checksummed USDC contract address
  maxTimeoutSeconds: number
  extra:             AssetTransferMethod
}

// EIP-3009 transferWithAuthorization parameters.
export interface EvmAuthorization {
  from:        string
  to:          string
  value:       string
  validAfter:  string
  validBefore: string
  nonce:       string // 32-byte hex
}

export interface ExactEvmPayload {
  signature:     string // 65-byte hex
  authorization: EvmAuthorization
}

export interface ResourceInfo {
  url:         string
  description: string
  mimeType:    string
}

// Sent (base64-encoded JSON) in the X-Payment header on retry.
export interface PaymentPayload {
  x402Version: number
  accepted:    PaymentRequirements
  payload:     ExactEvmPayload
  resource:    ResourceInfo
  extensions:  Record<string, unknown>
}

// HTTP 402 response body.
export interface PaymentRequired {
  x402Version: number
  error?:      string
  resource?:   ResourceInfo
  accepts:     PaymentRequirements[]
  extensions:  Record<string, unknown>
}
