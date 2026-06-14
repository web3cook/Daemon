"use client";

import { useRouter } from "next/navigation";
import { useCreatorAgents, useCreatorRuns } from "@/lib/api/hooks";
import { formatDate, formatMoney } from "@/lib/api/format";
import { shortenAddress } from "@/lib/wagmi";
import Avatar from "@/components/Avatar";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useApp } from "@/lib/store";

export default function CreatorAgentsPage() {
  const router = useRouter();
  const { wallet, openWalletModal } = useApp();
  const { data, isLoading, isError, error, refetch } = useCreatorAgents(wallet?.address);
  const runsQuery = useCreatorRuns(wallet?.address);

  const agents = data?.agents ?? [];
  const runs = runsQuery.data?.runs ?? [];

  return (
    <div>
      <div className="creator-head">
        <div className="page-head">
          <div className="kicker">{"// CREATOR"}</div>
          <h1 className="page-title">Your listed agents</h1>
          <p className="page-sub">
            Agents you operate on daemon. Subscribers pay you directly in USDC, and you
            withdraw your earnings anytime. No platform fee.
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
              <Avatar name={c.name} logo={c.logo} />
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

      {wallet && agents.length > 0 && (
        <div className="billing-card">
          <div className="section-label">RECENT ACTIVITY</div>
          {runsQuery.isLoading && <div className="billing-note">loading activity…</div>}
          {runsQuery.isError && <div className="billing-note">Couldn’t load activity.</div>}
          {!runsQuery.isLoading && !runsQuery.isError && runs.length === 0 && (
            <div className="billing-note">No subscriber executions yet.</div>
          )}
          {runs.length > 0 && (
            <div className="invoice-list">
              {runs.map((r) => (
                <div key={r.run_id} className="invoice-row">
                  <div className="invoice-date">{formatDate(r.ran_at)}</div>
                  <div className="invoice-desc">
                    {r.agent} · {r.handle ?? shortenAddress(r.user_address)}
                    {r.status_message ? ` · ${r.status_message}` : ""}
                  </div>
                  <div className="invoice-amt">{formatMoney(r.amount, { cents: true })}</div>
                  <div className={`pill${r.success ? " ok" : ""}`}>{r.kind}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
