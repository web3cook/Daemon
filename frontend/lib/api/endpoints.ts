import { apiGet, apiPost, type QueryParams } from "./client";
import type {
  AgentDetailDetails,
  AgentListDetails,
  AgentMutationDetails,
  CancelSubscriptionDetails,
  CreateSubscriptionDetails,
  CreatorAgentListDetails,
  EarningsDetails,
  NonceDetails,
  RecordRunDetails,
  RegisterAgentInput,
  RunListDetails,
  SortOption,
  SubscriberListDetails,
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
  mode?: string;
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

// ── one-time invocation (§7) ──────────────────────
// POC: one-time runs are invoked through the backend. The production model is a
// direct x402 call to the creator endpoint (see API_SPEC §7) plus recordRun().

export interface InvokeAgentDetails {
  invocation_id: string;
  status: string;
  agent?: { agent_id: string; name: string };
  inputs?: Record<string, unknown>;
  output: {
    summary?: string;
    result?: string;
    generated_at?: string;
  };
  receipt?: {
    amount?: { amount: string; currency: string };
    tx_hash: string;
    settled_at: string;
  };
}

export function invokeAgent(agentId: string, paramValues: Record<string, string>) {
  return apiPost<InvokeAgentDetails>(
    `/agents/${agentId}/invoke`,
    { param_values: paramValues },
    { "X-Payment": "poc-stub" },
  );
}

// ── subscriptions & spendings (§5) ────────────────

export function listUserSubscriptions(userAddress: string, status?: SubscriptionStatus) {
  return apiPost<SubscriptionListDetails>("/user/subscriptions", {
    user_address: userAddress,
    status,
  });
}

export function createSubscription(
  userAddress: string,
  agentId: string,
  subscriptionId: string,
  txHash: string,
) {
  return apiPost<CreateSubscriptionDetails>("/subscriptions", {
    user_address: userAddress,
    agent_id: agentId,
    // From the on-chain Subscriptions.subscribe() call that precedes this.
    // Subscriber params are read from the event by the indexer, not sent here.
    subscription_id: subscriptionId,
    tx_hash: txHash,
  });
}

export function cancelSubscription(subscriptionId: string, userAddress: string) {
  return apiPost<CancelSubscriptionDetails>(`/subscriptions/${subscriptionId}/cancel`, {
    user_address: userAddress,
  });
}

export function listUserRuns(userAddress: string, page = 1, limit = 20) {
  return apiPost<RunListDetails>("/user/runs", {
    user_address: userAddress,
    page,
    limit,
  });
}

/** Record a completed one-time (x402) run for the portfolio + creator earnings. */
export function recordRun(input: {
  userAddress: string;
  agentId: string;
  amount: { amount: string; currency: string };
  statusMessage: string;
  link?: string;
  success: boolean;
  txHash?: string;
}) {
  return apiPost<RecordRunDetails>("/runs", {
    user_address: input.userAddress,
    agent_id: input.agentId,
    amount: input.amount,
    status_message: input.statusMessage,
    link: input.link,
    success: input.success,
    tx_hash: input.txHash,
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

export function listSubscribers(userAddress: string, agentId: string, page = 1, limit = 20) {
  return apiPost<SubscriberListDetails>("/creator/agents/subscribers", {
    user_address: userAddress,
    agent_id: agentId,
    page,
    limit,
  });
}

export function getCreatorEarnings(userAddress: string) {
  return apiPost<EarningsDetails>("/creator/earnings", { user_address: userAddress });
}
