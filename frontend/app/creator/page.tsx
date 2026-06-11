"use client";

import { useRouter } from "next/navigation";
import { useCreatorAgents } from "@/lib/api/hooks";
import { formatMoney, monogram } from "@/lib/api/format";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useApp } from "@/lib/store";

export default function CreatorAgentsPage() {
  const router = useRouter();
  const { wallet, openWalletModal } = useApp();
  const { data, isLoading, isError, error, refetch } = useCreatorAgents(wallet?.address);

  const agents = data?.agents ?? [];

  return (
    <div>
      <div className="creator-head">
        <div className="page-head">
          <div className="kicker">{"// CREATOR"}</div>
          <h1 className="page-title">Your listed agents</h1>
          <p className="page-sub">
            Agents you operate on daemon. Subscribers pay you monthly, minus a 10% platform
            fee.
          </p>
        </div>
        <button className="btn-primary lg" onClick={() => router.push("/creator/register")}>
          + register new agent
        </button>
      </div>

      {!wallet && (
        <EmptyState title="No wallet connected" sub="Connect to see the agents you operate.">
          <button className="btn-primary" onClick={openWalletModal}>
            connect wallet
          </button>
        </EmptyState>
      )}

      {wallet && isLoading && <LoadingState label="loading your agents…" />}
      {wallet && isError && <ErrorState error={error} onRetry={() => refetch()} />}
      {wallet && !isLoading && !isError && agents.length === 0 && (
        <EmptyState title="No agents yet" sub="Register your first agent to start earning.">
          <button className="btn-primary" onClick={() => router.push("/creator/register")}>
            register an agent
          </button>
        </EmptyState>
      )}

      {agents.length > 0 && (
        <div className="row-stack">
          {agents.map((c) => (
            <div key={c.agent_id} className="row-card">
              <div className="avatar">{monogram(c.name)}</div>
              <div className="row-id wide">
                <div className="row-title">{c.name}</div>
                <div className="row-sub">
                  {c.tagline} · {c.category}
                </div>
              </div>
              <div className={`status-pill${c.status === "live" ? " live" : ""}`}>
                {c.status}
              </div>
              <div className="spacer" />
              <div className="row-subs-count">{c.subscriber_count} subscribers</div>
              <div className="row-price wide">
                {formatMoney(c.monthly_recurring_revenue)}
                <span className="price-unit"> mrr</span>
              </div>
              <button className="btn-ghost">edit listing</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
