"use client";

import { useRouter } from "next/navigation";
import { AGENTS, fromPrice } from "@/lib/agents";

export default function MarketplacePage() {
  const router = useRouter();

  return (
    <div>
      <div className="page-head">
        <div className="kicker">{"// MARKETPLACE"}</div>
        <h1 className="page-title">Discover agents</h1>
        <p className="page-sub">
          {AGENTS.length} agents · pricing set per-agent by its creator
        </p>
      </div>

      <div className="market-grid">
        {AGENTS.map((a) => (
          <article
            key={a.id}
            className="agent-card"
            onClick={() => router.push(`/agents/${a.id}`)}
          >
            <div className="agent-card-head">
              <div className="avatar">{a.av}</div>
              <div>
                <div className="agent-name">{a.name}</div>
                <div className="agent-meta">
                  ★ {a.rating} · {a.tag}
                </div>
              </div>
            </div>
            <p className="agent-desc">{a.desc}</p>
            <div className="chip-row">
              {a.services.map((s) => (
                <div key={s} className="chip">
                  {s}
                </div>
              ))}
            </div>
            <div className="agent-card-foot">
              <div className="price-label">
                ${fromPrice(a)}
                <span className="price-unit">/mo</span>
              </div>
              <div className="view-plans">view plans →</div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
