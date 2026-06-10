"use client";

import { useRouter } from "next/navigation";
import { agentById, USAGE_MAP } from "@/lib/agents";
import { useApp } from "@/lib/store";

export default function SubscriptionsPage() {
  const router = useRouter();
  const { subs, wallet, cancelSub, openWalletModal } = useApp();

  const mySubs = Object.keys(subs)
    .map((id) => {
      const agent = agentById(id);
      if (!agent) return null;
      const plan = agent.plans.find((p) => p.name === subs[id]) ?? agent.plans[0];
      return { agent, plan };
    })
    .filter((s) => s !== null);

  const monthlyTotal = mySubs.reduce((sum, s) => sum + s.plan.price, 0);

  const invoices = [
    { date: "Jun 1, 2026", desc: "Monthly subscriptions", amount: `$${monthlyTotal}.00` },
    { date: "May 1, 2026", desc: "Monthly subscriptions", amount: "$12.00" },
    { date: "Apr 1, 2026", desc: "Monthly subscriptions", amount: "$12.00" },
  ];

  return (
    <div>
      <div className="page-head">
        <div className="kicker">{"// MY SUBSCRIPTIONS"}</div>
        <h1 className="page-title">Your agents</h1>
        <p className="page-sub">
          {mySubs.length} active {mySubs.length === 1 ? "subscription" : "subscriptions"} · $
          {monthlyTotal}/mo
        </p>
      </div>

      {mySubs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No active subscriptions</div>
          <div className="empty-sub">Browse the marketplace to put an agent to work.</div>
          <button className="btn-primary" onClick={() => router.push("/")}>
            browse marketplace
          </button>
        </div>
      ) : (
        <div className="row-stack subs">
          {mySubs.map(({ agent, plan }) => (
            <div key={agent.id} className="row-card">
              <div className="avatar">{agent.av}</div>
              <div className="row-id">
                <div className="row-title">{agent.name}</div>
                <div className="row-sub">{plan.name} plan</div>
              </div>
              <div className="active-tag">
                <div className="dot sm" />
                active
              </div>
              <div className="spacer" />
              <div className="usage-note">{USAGE_MAP[agent.id] ?? "active this month"}</div>
              <div className="row-price">
                ${plan.price}
                <span className="price-unit">/mo</span>
              </div>
              <button
                className="btn-ghost"
                onClick={() => router.push(`/agents/${agent.id}`)}
              >
                manage
              </button>
              <button className="btn-quiet" onClick={() => cancelSub(agent.id)}>
                cancel
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="billing-grid">
        <div className="billing-card">
          <div className="section-label">PAYMENT — WALLET</div>
          {wallet ? (
            <>
              <div className="wallet-line">
                <div className="dot" />
                <div className="wallet-addr">{wallet.addr}</div>
              </div>
              <div className="billing-note balance">
                usdc balance · <span className="strong">$142.50</span>
              </div>
              <div className="billing-note">
                Next charge: <span className="strong">${monthlyTotal}.00</span> on Jul 1, 2026
              </div>
            </>
          ) : (
            <>
              <div className="billing-empty">
                No wallet connected. Connect to manage billing.
              </div>
              <button className="connect-btn" onClick={openWalletModal}>
                connect wallet
              </button>
            </>
          )}
        </div>

        <div className="billing-card">
          <div className="section-label">INVOICES</div>
          <div className="invoice-list">
            {invoices.map((inv) => (
              <div key={inv.date} className="invoice-row">
                <div className="invoice-date">{inv.date}</div>
                <div className="invoice-desc">{inv.desc}</div>
                <div className="invoice-amt">{inv.amount}</div>
                <div className="pill ok">paid</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
