"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AgentQuery,
  cancelSubscription,
  createSubscription,
  getAgent,
  getBilling,
  getCreatorEarnings,
  listAgents,
  listCreatorAgents,
  listInvoices,
  listUserSubscriptions,
  onboardUser,
  registerAgent,
  updateAgent,
} from "./endpoints";
import type {
  RegisterAgentInput,
  SubscriptionStatus,
  UpdateAgentInput,
  UserRole,
} from "./types";

export const queryKeys = {
  agents: (query: AgentQuery) => ["agents", query] as const,
  agent: (agentId: string) => ["agent", agentId] as const,
  subscriptions: (address?: string, status?: string) =>
    ["subscriptions", address, status] as const,
  billing: (address?: string) => ["billing", address] as const,
  invoices: (address?: string, page?: number) => ["invoices", address, page] as const,
  creatorAgents: (address?: string) => ["creator-agents", address] as const,
  earnings: (address?: string) => ["earnings", address] as const,
};

// ── marketplace ───────────────────────────────────

export function useAgents(query: AgentQuery = {}) {
  return useQuery({
    queryKey: queryKeys.agents(query),
    queryFn: () => listAgents(query),
  });
}

export function useAgent(agentId: string) {
  return useQuery({
    queryKey: queryKeys.agent(agentId),
    queryFn: () => getAgent(agentId),
    enabled: !!agentId,
  });
}

// ── subscriptions & billing (wallet-scoped) ───────

export function useUserSubscriptions(address?: string, status?: SubscriptionStatus) {
  return useQuery({
    queryKey: queryKeys.subscriptions(address, status),
    queryFn: () => listUserSubscriptions(address!, status),
    enabled: !!address,
  });
}

export function useBilling(address?: string) {
  return useQuery({
    queryKey: queryKeys.billing(address),
    queryFn: () => getBilling(address!),
    enabled: !!address,
  });
}

export function useInvoices(address?: string, page = 1, limit = 20) {
  return useQuery({
    queryKey: queryKeys.invoices(address, page),
    queryFn: () => listInvoices(address!, page, limit),
    enabled: !!address,
  });
}

// ── creator (wallet-scoped) ───────────────────────

export function useCreatorAgents(address?: string) {
  return useQuery({
    queryKey: queryKeys.creatorAgents(address),
    queryFn: () => listCreatorAgents(address!),
    enabled: !!address,
  });
}

export function useCreatorEarnings(address?: string) {
  return useQuery({
    queryKey: queryKeys.earnings(address),
    queryFn: () => getCreatorEarnings(address!),
    enabled: !!address,
  });
}

// ── mutations ─────────────────────────────────────

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      address: string;
      agentId: string;
      planId: string;
      subscriptionId: string;
      txHash: string;
    }) =>
      createSubscription(vars.address, vars.agentId, vars.planId, vars.subscriptionId, vars.txHash),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["subscriptions", vars.address] });
      qc.invalidateQueries({ queryKey: queryKeys.billing(vars.address) });
      qc.invalidateQueries({ queryKey: queryKeys.agent(vars.agentId) });
    },
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { subscriptionId: string; address: string }) =>
      cancelSubscription(vars.subscriptionId, vars.address),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["subscriptions", vars.address] });
      qc.invalidateQueries({ queryKey: queryKeys.billing(vars.address) });
    },
  });
}

export function useOnboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { address: string; handle: string; role: UserRole }) =>
      onboardUser(vars.address, vars.handle, vars.role),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["user", vars.address] });
    },
  });
}

export function useRegisterAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterAgentInput) => registerAgent(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.creatorAgents(input.user_address) });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAgentInput) => updateAgent(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.creatorAgents(input.user_address) });
      qc.invalidateQueries({ queryKey: queryKeys.agent(input.agent_id) });
    },
  });
}
