"use client";

import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";

export default function CreatorAgentsPage() {
  const router = useRouter();
  const { published } = useApp();

  const listings = [
    { av: "pu", name: "Pulse", tag: "dca-agent · Finance", subsLabel: "1,214", mrr: "$4,230" },
    ...published.map((p) => ({ av: p.av, name: p.name, tag: p.tag, subsLabel: "0", mrr: "$0" })),
  ];

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

      <div className="row-stack">
        {listings.map((c) => (
          <div key={c.name} className="row-card">
            <div className="avatar">{c.av}</div>
            <div className="row-id wide">
              <div className="row-title">{c.name}</div>
              <div className="row-sub">{c.tag}</div>
            </div>
            <div className="status-pill live">live</div>
            <div className="spacer" />
            <div className="row-subs-count">{c.subsLabel} subscribers</div>
            <div className="row-price wide">
              {c.mrr}
              <span className="price-unit"> mrr</span>
            </div>
            <button className="btn-ghost">edit listing</button>
          </div>
        ))}
      </div>
    </div>
  );
}
