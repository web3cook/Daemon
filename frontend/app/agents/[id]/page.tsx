"use client";

import { useParams, useRouter } from "next/navigation";
import { agentById } from "@/lib/agents";
import { useApp } from "@/lib/store";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { subs, requestSubscribe } = useApp();

  const agent = agentById(id);

  if (!agent) {
    return (
      <div>
        <button className="back-link" onClick={() => router.push("/")}>
          ← marketplace
        </button>
        <div className="empty-state">
          <div className="empty-title">Agent not found</div>
          <div className="empty-sub">It may have been unlisted by its creator.</div>
          <button className="btn-primary" onClick={() => router.push("/")}>
            browse marketplace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button className="back-link" onClick={() => router.push("/")}>
        ← marketplace
      </button>

      <div className="detail-head">
        <div className="avatar lg">{agent.av}</div>
        <div>
          <h1 className="detail-title">{agent.name}</h1>
          <div className="detail-meta">
            ★ {agent.rating} · {agent.tag} · {agent.subsCount} subscribers · by{" "}
            {agent.publisher}
          </div>
        </div>
        <div className="pricing-badge">pricing: {agent.model}</div>
      </div>

      <p className="long-desc">{agent.longDesc}</p>

      <div className="chip-row detail-chips">
        {agent.services.map((s) => (
          <div key={s} className="chip">
            {s}
          </div>
        ))}
      </div>

      <div className="kicker plans-label">{"// PLANS — SET BY CREATOR"}</div>
      <div className="plans-grid">
        {agent.plans.map((p, i) => {
          const current = subs[agent.id] === p.name;
          return (
            <div key={p.name} className={`plan-card${current ? " current" : ""}`}>
              <div className="plan-name">{p.name}</div>
              <div className="plan-price-row">
                <div className="plan-price">${p.price}</div>
                <div className="plan-price-unit">/mo</div>
              </div>
              {p.meter && <div className="plan-meter">{p.meter}</div>}
              <div className="plan-detail">{p.detail}</div>
              <button
                className={`plan-btn${current ? " current" : ""}`}
                onClick={current ? undefined : () => requestSubscribe(agent.id, i)}
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
