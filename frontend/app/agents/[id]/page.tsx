"use client";

import { useParams, useRouter } from "next/navigation";
import { useAgent, useUserSubscriptions } from "@/lib/api/hooks";
import { formatMeter, formatMoney, monogram } from "@/lib/api/format";
import { ErrorState, LoadingState } from "@/components/States";
import { useApp } from "@/lib/store";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { wallet, requestSubscribe } = useApp();
  const { data, isLoading, isError, error, refetch } = useAgent(id);
  const { data: subsData } = useUserSubscriptions(wallet?.address);

  const back = (
    <button className="back-link" onClick={() => router.push("/")}>
      ← marketplace
    </button>
  );

  if (isLoading) {
    return (
      <div>
        {back}
        <LoadingState label="loading agent…" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        {back}
        <ErrorState error={error ?? new Error("Agent not found")} onRetry={() => refetch()} />
      </div>
    );
  }

  const agent = data.agent;
  const currentPlanIds = new Set(
    (subsData?.subscriptions ?? [])
      .filter((s) => s.agent_id === agent.agent_id && s.status === "active")
      .map((s) => s.plan_id),
  );

  return (
    <div>
      {back}

      <div className="detail-head">
        <div className="avatar lg">{monogram(agent.name)}</div>
        <div>
          <h1 className="detail-title">{agent.name}</h1>
          <div className="detail-meta">
            ★ {agent.rating} · {agent.tagline} · {agent.subscriber_count} subscribers · by{" "}
            {agent.publisher_name}
          </div>
        </div>
        <div className="pricing-badge">pricing: {agent.pricing_model}</div>
      </div>

      <p className="long-desc">{agent.description}</p>

      <div className="chip-row detail-chips">
        {agent.services.map((s) => (
          <div key={s} className="chip">
            {s}
          </div>
        ))}
      </div>

      <div className="kicker plans-label">{"// PLANS — SET BY CREATOR"}</div>
      <div className="plans-grid">
        {agent.plans.map((p) => {
          const current = currentPlanIds.has(p.plan_id);
          const meter = formatMeter(p.usage_price, p.usage_unit);
          return (
            <div key={p.plan_id} className={`plan-card${current ? " current" : ""}`}>
              <div className="plan-name">{p.name}</div>
              <div className="plan-price-row">
                <div className="plan-price">{formatMoney(p.base_price, { cents: false })}</div>
                <div className="plan-price-unit">/mo</div>
              </div>
              {meter && <div className="plan-meter">{meter}</div>}
              <div className="plan-detail">{p.description}</div>
              <button
                className={`plan-btn${current ? " current" : ""}`}
                onClick={
                  current
                    ? undefined
                    : () =>
                        requestSubscribe({
                          agentId: agent.agent_id,
                          agentName: agent.name,
                          planId: p.plan_id,
                          planName: p.name,
                          price: p.base_price,
                          meter,
                        })
                }
              >
                {current ? "current plan" : "subscribe"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
