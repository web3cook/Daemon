import { apiGet, apiPost, type QueryParams } from "./client";
import type {
  AgentDetailDetails,
  AgentListDetails,
  AgentMutationDetails,
  BillingDetails,
  CancelSubscriptionDetails,
  CreateSubscriptionDetails,
  CreatorAgentListDetails,
  EarningsDetails,
  InvoiceListDetails,
  NonceDetails,
  RegisterAgentInput,
  SortOption,
  SubscriptionListDetails,
  SubscriptionStatus,
  UpdateAgentInput,
  UserDetails,
  UserRole,
  VerifyDetails,
} from "./types";

// ── auth & onboarding (§3) ────────────────────────

export function requestNonce(userAddress: string) {
  return apiPost<NonceDetails>("/auth/nonce", { user_address: userAddress });
}

export function verifyWallet(userAddress: string, signature: string) {
  return apiPost<VerifyDetails>("/auth/verify", {
    user_address: userAddress,
    signature,
  });
}

export function onboardUser(userAddress: string, handle: string, role: UserRole) {
  return apiPost<UserDetails>("/user/onboard", {
    user_address: userAddress,
    handle,
    role,
  });
}

// ── marketplace (§4) ──────────────────────────────

export interface AgentQuery {
  category?: string;
  search?: string;
  sort?: SortOption;
  page?: number;
  limit?: number;
}

export function listAgents(query: AgentQuery = {}) {
  return apiGet<AgentListDetails>("/agents", query as QueryParams);
}

export function getAgent(agentId: string) {
  return apiGet<AgentDetailDetails>(`/agents/${agentId}`);
}

// ── subscriptions & billing (§5) ──────────────────

export function listUserSubscriptions(userAddress: string, status?: SubscriptionStatus) {
  return apiPost<SubscriptionListDetails>("/user/subscriptions", {
    user_address: userAddress,
    status,
  });
}

export function createSubscription(
  userAddress: string,
  agentId: string,
  planId: string,
  subscriptionId: string,
  txHash: string,
) {
  return apiPost<CreateSubscriptionDetails>("/subscriptions", {
    user_address: userAddress,
    agent_id: agentId,
    plan_id: planId,
    // From the on-chain Subscriptions.subscribe() call that precedes this.
    subscription_id: subscriptionId,
    tx_hash: txHash,
  });
}

export function cancelSubscription(subscriptionId: string, userAddress: string) {
  return apiPost<CancelSubscriptionDetails>(`/subscriptions/${subscriptionId}/cancel`, {
    user_address: userAddress,
  });
}

export function getBilling(userAddress: string) {
  return apiPost<BillingDetails>("/user/billing", { user_address: userAddress });
}

export function listInvoices(userAddress: string, page = 1, limit = 20) {
  return apiPost<InvoiceListDetails>("/user/invoices", {
    user_address: userAddress,
    page,
    limit,
  });
}

// ── creator (§6) ──────────────────────────────────

export function listCreatorAgents(userAddress: string) {
  return apiPost<CreatorAgentListDetails>("/creator/agents/list", {
    user_address: userAddress,
  });
}

export function registerAgent(input: RegisterAgentInput) {
  return apiPost<AgentMutationDetails>("/creator/agents/register", input);
}

export function updateAgent(input: UpdateAgentInput) {
  return apiPost<AgentMutationDetails>("/creator/agents/update", input);
}

export function getCreatorEarnings(userAddress: string) {
  return apiPost<EarningsDetails>("/creator/earnings", { user_address: userAddress });
}
