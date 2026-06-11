"use client";

import { useApp } from "@/lib/store";

const STAT_CARDS = [
  { k: "MRR (NET)", v: "$3,807", sub: "+8.2% vs May", up: true },
  { k: "ACTIVE SUBSCRIBERS", v: "1,214", sub: "+41 this month", up: true },
  { k: "NEXT PAYOUT", v: "$1,094", sub: "Fri, Jun 12", up: false },
  { k: "LIFETIME REVENUE", v: "$38.5k", sub: "since Nov 2024", up: false },
];

const REV_DATA = [
  { m: "nov", v: 2210 },
  { m: "dec", v: 2480 },
  { m: "jan", v: 2630 },
  { m: "feb", v: 2890 },
  { m: "mar", v: 3120 },
  { m: "apr", v: 3340 },
  { m: "may", v: 3520 },
  { m: "jun", v: 3807 },
];

const PAYOUTS = [
  { date: "Jun 5", amount: "$1,058.40", status: "paid" },
  { date: "May 29", amount: "$987.20", status: "paid" },
  { date: "May 22", amount: "$1,012.65", status: "paid" },
  { date: "Jun 12", amount: "$1,094.00", status: "scheduled" },
];

export default function EarningsPage() {
  const { published } = useApp();

  const maxRev = Math.max(...REV_DATA.map((d) => d.v));
  const byAgent = [
    { name: "Pulse", subs: "1,214 subscribers", mrr: "$3,807" },
    ...published.map((p) => ({ name: p.name, subs: "0 subscribers", mrr: "$0" })),
  ];

  return (
    <div>
      <div className="page-head">
        <div className="kicker">{"// EARNINGS"}</div>
        <h1 className="page-title">Payouts &amp; revenue</h1>
        <p className="page-sub">
          Net of daemon&apos;s 10% platform fee. Payouts run every Friday.
        </p>
      </div>

      <div className="stats-grid">
        {STAT_CARDS.map((stat) => (
          <div key={stat.k} className="stat-card">
            <div className="stat-key">{stat.k}</div>
            <div className="stat-val">{stat.v}</div>
            <div className={`stat-sub${stat.up ? " up" : ""}`}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <div className="earnings-grid">
        <div className="panel">
          <div className="section-label chart">NET REVENUE · LAST 8 MONTHS</div>
          <div className="bars">
            {REV_DATA.map((d, i) => (
              <div key={d.m} className="bar-col">
                <div className="bar-amt">${(d.v / 1000).toFixed(1)}k</div>
                <div
                  className={`bar${i === REV_DATA.length - 1 ? " hot" : ""}`}
                  style={{ height: `${Math.round((d.v / maxRev) * 100)}%` }}
                />
                <div className="bar-month">{d.m}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="earnings-side">
          <div className="panel">
            <div className="section-label">RECENT PAYOUTS</div>
            <div className="payout-list">
              {PAYOUTS.map((po) => (
                <div key={po.date} className="payout-row">
                  <div className="payout-date">{po.date}</div>
                  <div className="payout-amt">{po.amount}</div>
                  <div className={`pill${po.status === "paid" ? " ok" : ""}`}>{po.status}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="section-label">BY AGENT</div>
            <div className="byagent-list">
              {byAgent.map((ae) => (
                <div key={ae.name} className="byagent-row">
                  <div className="byagent-name">{ae.name}</div>
                  <div className="byagent-subs">{ae.subs}</div>
                  <div className="byagent-mrr">{ae.mrr}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
