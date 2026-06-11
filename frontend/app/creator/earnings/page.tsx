"use client";

import { useCreatorEarnings } from "@/lib/api/hooks";
import { formatDate, formatMoney, formatMonth } from "@/lib/api/format";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useApp } from "@/lib/store";

function compactMoney(amount: string): string {
  const n = Number(amount);
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
}

export default function EarningsPage() {
  const { wallet, openWalletModal } = useApp();
  const { data, isLoading, isError, error, refetch } = useCreatorEarnings(wallet?.address);

  const head = (
    <div className="page-head">
      <div className="kicker">{"// EARNINGS"}</div>
      <h1 className="page-title">Payouts &amp; revenue</h1>
      <p className="page-sub">Net of daemon&apos;s 10% platform fee. Payouts run every Friday.</p>
    </div>
  );

  if (!wallet) {
    return (
      <div>
        {head}
        <EmptyState title="No wallet connected" sub="Connect to see your earnings.">
          <button className="btn-primary" onClick={openWalletModal}>
            connect wallet
          </button>
        </EmptyState>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        {head}
        <LoadingState label="loading earnings…" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        {head}
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const { stats, revenue_by_month, payouts, earnings_by_agent } = data;
  const maxRev = Math.max(...revenue_by_month.map((d) => Number(d.net.amount)), 1);

  const statCards = [
    {
      k: "MRR (NET)",
      v: formatMoney(stats.net_monthly_recurring_revenue),
      sub: `+${stats.mrr_change_percent}% vs last month`,
      up: true,
    },
    {
      k: "ACTIVE SUBSCRIBERS",
      v: stats.active_subscribers.toLocaleString("en-US"),
      sub: `+${stats.subscriber_change} this month`,
      up: true,
    },
    {
      k: "NEXT PAYOUT",
      v: formatMoney(stats.next_payout.amount),
      sub: formatDate(stats.next_payout.payout_at),
      up: false,
    },
    {
      k: "LIFETIME REVENUE",
      v: formatMoney(stats.lifetime_revenue),
      sub: "all time",
      up: false,
    },
  ];

  return (
    <div>
      {head}

      <div className="stats-grid">
        {statCards.map((stat) => (
          <div key={stat.k} className="stat-card">
            <div className="stat-key">{stat.k}</div>
            <div className="stat-val">{stat.v}</div>
            <div className={`stat-sub${stat.up ? " up" : ""}`}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <div className="earnings-grid">
        <div className="panel">
          <div className="section-label chart">
            NET REVENUE · LAST {revenue_by_month.length} MONTHS
          </div>
          <div className="bars">
            {revenue_by_month.map((d, i) => (
              <div key={d.month} className="bar-col">
                <div className="bar-amt">{compactMoney(d.net.amount)}</div>
                <div
                  className={`bar${i === revenue_by_month.length - 1 ? " hot" : ""}`}
                  style={{ height: `${Math.round((Number(d.net.amount) / maxRev) * 100)}%` }}
                />
                <div className="bar-month">{formatMonth(d.month)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="earnings-side">
          <div className="panel">
            <div className="section-label">RECENT PAYOUTS</div>
            <div className="payout-list">
              {payouts.map((po) => (
                <div key={po.payout_id} className="payout-row">
                  <div className="payout-date">{formatDate(po.payout_at)}</div>
                  <div className="payout-amt">{formatMoney(po.amount, { cents: true })}</div>
                  <div className={`pill${po.status === "paid" ? " ok" : ""}`}>{po.status}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="section-label">BY AGENT</div>
            <div className="byagent-list">
              {earnings_by_agent.map((ae) => (
                <div key={ae.agent_id} className="byagent-row">
                  <div className="byagent-name">{ae.agent_name}</div>
                  <div className="byagent-subs">{ae.subscriber_count} subscribers</div>
                  <div className="byagent-mrr">{formatMoney(ae.monthly_recurring_revenue)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
