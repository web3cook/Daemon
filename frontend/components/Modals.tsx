"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/api/format";
import { useApp, type Role } from "@/lib/store";

function OnboardModal() {
  const { onboardOpen, onboardPending, wallet, finishOnboard } = useApp();
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<Role>("sub");

  if (!onboardOpen) return null;

  const roleOpts: { key: Role; label: string; hint: string }[] = [
    { key: "sub", label: "subscribe", hint: "Put agents to work" },
    { key: "cre", label: "create", hint: "List & earn from agents" },
  ];

  return (
    <div className="overlay deep">
      <div className="modal onboard">
        <div className="kicker">{"// WELCOME TO DAEMON"}</div>
        <div className="modal-title tight">Set up your account</div>
        <div className="connected-line">
          <div className="dot" />
          connected · {wallet?.addr}
        </div>

        <div className="field ob-field">
          <label className="field-label">HANDLE</label>
          <input
            className="ob-input"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@yourname"
          />
        </div>

        <div className="field ob-field roles">
          <label className="field-label">I&apos;M HERE TO…</label>
          <div className="ob-roles">
            {roleOpts.map((o) => (
              <button
                key={o.key}
                className={`ob-role${role === o.key ? " on" : ""}`}
                onClick={() => setRole(o.key)}
              >
                <div className="ob-role-label">{o.label}</div>
                <div className="ob-role-hint">{o.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <button
          className="btn-enter"
          disabled={onboardPending}
          onClick={() => finishOnboard(handle, role)}
        >
          {onboardPending ? "linking…" : "enter daemon →"}
        </button>
      </div>
    </div>
  );
}

function SubscribeModal() {
  const { pendingSub, subscribePending, subscribePhase, wallet, closeSubModal, confirmSub } =
    useApp();

  if (!pendingSub) return null;
  const priceLabel = formatMoney(pendingSub.price);
  const payMethod = wallet ? `usdc · ${wallet.addr}` : "usdc · wallet";

  return (
    <div className="overlay" onClick={closeSubModal}>
      <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
        <div className="kicker">{"// CONFIRM SUBSCRIPTION"}</div>
        <div className="modal-title roomy">
          {pendingSub.agentName} · {pendingSub.planName}
        </div>
        <div className="confirm-rows">
          <div className="confirm-row">
            <span className="k">price</span>
            <span>{priceLabel}/mo</span>
          </div>
          {pendingSub.meter && (
            <div className="confirm-row">
              <span className="k">usage</span>
              <span className="meter">{pendingSub.meter}</span>
            </div>
          )}
          <div className="confirm-row">
            <span className="k">billed</span>
            <span>monthly · cancel anytime</span>
          </div>
          <div className="confirm-row">
            <span className="k">payment</span>
            <span>{payMethod}</span>
          </div>
        </div>
        <div className="confirm-actions">
          <button className="btn-cancel" onClick={closeSubModal} disabled={subscribePending}>
            cancel
          </button>
          <button className="btn-confirm" onClick={confirmSub} disabled={subscribePending}>
            {subscribePhase ?? `confirm — ${priceLabel}/mo`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}

export default function Modals() {
  return (
    <>
      <OnboardModal />
      <SubscribeModal />
      <Toast />
    </>
  );
}
