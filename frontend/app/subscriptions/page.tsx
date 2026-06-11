"use client";

import { useRouter } from "next/navigation";
import { useBilling, useInvoices, useUserSubscriptions } from "@/lib/api/hooks";
import { formatDate, formatMoney, monogram } from "@/lib/api/format";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useApp } from "@/lib/store";

export default function SubscriptionsPage() {
  const router = useRouter();
  const { wallet, openWalletModal, cancelSub } = useApp();
  const address = wallet?.address;

  const subsQuery = useUserSubscriptions(address);
  const billingQuery = useBilling(address);
  const invoicesQuery = useInvoices(address);

  if (!wallet) {
    return (
      <div>
        <div className="page-head">
          <div className="kicker">{"// MY SUBSCRIPTIONS"}</div>
          <h1 className="page-title">Your agents</h1>
          <p className="page-sub">Connect a wallet to see your subscriptions and billing.</p>
        </div>
        <EmptyState title="No wallet connected" sub="Connect to view the agents you’ve put to work.">
          <button className="btn-primary" onClick={openWalletModal}>
            connect wallet
          </button>
        </EmptyState>
      </div>
    );
  }

  const subs = subsQuery.data?.subscriptions ?? [];
  const summary = subsQuery.data?.summary;
  const billing = billingQuery.data;
  const invoices = invoicesQuery.data?.invoices ?? [];

  return (
    <div>
      <div className="page-head">
        <div className="kicker">{"// MY SUBSCRIPTIONS"}</div>
        <h1 className="page-title">Your agents</h1>
        <p className="page-sub">
          {summary
            ? `${summary.active_count} active ${
                summary.active_count === 1 ? "subscription" : "subscriptions"
              } · ${formatMoney(summary.monthly_total)}/mo`
            : "—"}
        </p>
      </div>

      {subsQuery.isLoading && <LoadingState label="loading subscriptions…" />}
      {subsQuery.isError && (
        <ErrorState error={subsQuery.error} onRetry={() => subsQuery.refetch()} />
      )}
      {!subsQuery.isLoading && !subsQuery.isError && subs.length === 0 && (
        <EmptyState
          title="No active subscriptions"
          sub="Browse the marketplace to put an agent to work."
        >
          <button className="btn-primary" onClick={() => router.push("/")}>
            browse marketplace
          </button>
        </EmptyState>
      )}

      {subs.length > 0 && (
        <div className="row-stack subs">
          {subs.map((s) => {
            const price = s.next_payment_amount ?? s.last_payment_amount;
            return (
              <div key={s.id} className="row-card">
                <div className="avatar">{monogram(s.agent)}</div>
                <div className="row-id">
                  <div className="row-title">{s.agent}</div>
                  <div className="row-sub">{s.plan_name} plan</div>
                </div>
                <div className="active-tag">
                  <div className="dot sm" />
                  {s.status}
                </div>
                <div className="spacer" />
                <div className="usage-note">{s.usage_summary}</div>
                <div className="row-price">
                  {formatMoney(price, { cents: false })}
                  <span className="price-unit">/mo</span>
                </div>
                <button
                  className="btn-ghost"
                  onClick={() => router.push(`/agents/${s.agent_id}`)}
                >
                  manage
                </button>
                <button className="btn-quiet" onClick={() => cancelSub(s.id, s.agent)}>
                  cancel
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="billing-grid">
        <div className="billing-card">
          <div className="section-label">PAYMENT — WALLET</div>
          <div className="wallet-line">
            <div className="dot" />
            <div className="wallet-addr">{wallet.addr}</div>
          </div>
          {billing ? (
            <>
              <div className="billing-note balance">
                usdc balance · <span className="strong">{formatMoney(billing.balance, { cents: true })}</span>
              </div>
              <div className="billing-note">
                {billing.next_charge ? (
                  <>
                    Next charge:{" "}
                    <span className="strong">
                      {formatMoney(billing.next_charge.amount, { cents: true })}
                    </span>{" "}
                    on {formatDate(billing.next_charge.charge_at)}
                  </>
                ) : (
                  "No upcoming charges."
                )}
              </div>
            </>
          ) : (
            <div className="billing-note">
              {billingQuery.isError ? "Couldn’t load billing." : "loading balance…"}
            </div>
          )}
        </div>

        <div className="billing-card">
          <div className="section-label">INVOICES</div>
          {invoicesQuery.isLoading && <div className="billing-note">loading invoices…</div>}
          {invoicesQuery.isError && <div className="billing-note">Couldn’t load invoices.</div>}
          {!invoicesQuery.isLoading && !invoicesQuery.isError && invoices.length === 0 && (
            <div className="billing-note">No invoices yet.</div>
          )}
          {invoices.length > 0 && (
            <div className="invoice-list">
              {invoices.map((inv) => (
                <div key={inv.invoice_id} className="invoice-row">
                  <div className="invoice-date">{formatDate(inv.issued_at)}</div>
                  <div className="invoice-desc">{inv.description}</div>
                  <div className="invoice-amt">{formatMoney(inv.amount, { cents: true })}</div>
                  <div className={`pill${inv.status === "paid" ? " ok" : ""}`}>{inv.status}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
