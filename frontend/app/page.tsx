"use client";

import { useRouter } from "next/navigation";
import { useAgents } from "@/lib/api/hooks";
import { formatMoney, monogram } from "@/lib/api/format";
import { ErrorState, LoadingState, EmptyState } from "@/components/States";

export default function MarketplacePage() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useAgents();

  const agents = data?.agents ?? [];

  return (
    <div>
      <div className="page-head">
        <div className="kicker">{"// MARKETPLACE"}</div>
        <h1 className="page-title">Discover agents</h1>
        <p className="page-sub">
          {data ? `${data.pagination.total_items} agents · ` : ""}pricing set per-agent by its
          creator
        </p>
      </div>

      {isLoading && <LoadingState label="loading agents…" />}
      {isError && <ErrorState error={error} onRetry={() => refetch()} />}
      {!isLoading && !isError && agents.length === 0 && (
        <EmptyState title="No agents yet" sub="Check back soon — creators are onboarding." />
      )}

      {agents.length > 0 && (
        <div className="market-grid">
          {agents.map((a) => (
            <article
              key={a.agent_id}
              className="agent-card"
              onClick={() => router.push(`/agents/${a.agent_id}`)}
            >
              <div className="agent-card-head">
                <div className="avatar">{monogram(a.name)}</div>
                <div>
                  <div className="agent-name">{a.name}</div>
                  <div className="agent-meta">
                    ★ {a.rating} · {a.tagline}
                  </div>
                </div>
              </div>
              <p className="agent-desc">{a.short_description}</p>
              <div className="chip-row">
                {a.services.map((s) => (
                  <div key={s} className="chip">
                    {s}
                  </div>
                ))}
              </div>
              <div className="agent-card-foot">
                <div className="price-label">
                  {formatMoney(a.from_price, { cents: false })}
                  <span className="price-unit">/mo</span>
                </div>
                <div className="view-plans">view plans →</div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
