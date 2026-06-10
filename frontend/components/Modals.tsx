"use client";

import { useState } from "react";
import { agentById, WALLETS } from "@/lib/agents";
import { useApp, type Role } from "@/lib/store";

function WalletModal() {
  const {
    walletModalOpen,
    connecting,
    closeWalletModal,
    connectWallet,
    cancelConnecting,
  } = useApp();

  if (!walletModalOpen) return null;

  return (
    <div className="overlay" onClick={closeWalletModal}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="kicker">{"// SIGN IN"}</div>
        <div className="modal-title">Connect a wallet</div>

        {connecting ? (
          <div className="connecting">
            <div className="spinner" />
            <div className="connecting-name">waiting for {connecting.name}…</div>
            <div className="connecting-hint">approve the connection in your wallet</div>
            <button className="btn-ghost" onClick={cancelConnecting}>
              cancel
            </button>
          </div>
        ) : (
          <>
            <div className="wallet-opts">
              {WALLETS.map((w) => (
                <button key={w.id} className="wallet-opt" onClick={() => connectWallet(w)}>
                  <div className="wallet-ic" style={{ background: w.bg }}>
                    {w.ic}
                  </div>
                  <div className="wallet-opt-name">{w.name}</div>
                  <div className="wallet-opt-arrow">→</div>
                </button>
              ))}
            </div>
            <div className="modal-footnote">
              powered by rainbowkit · by connecting you agree to the <span>terms of use</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OnboardModal() {
  const { onboardOpen, wallet, finishOnboard } = useApp();
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

        <button className="btn-enter" onClick={() => finishOnboard(handle, role)}>
          enter daemon →
        </button>
      </div>
    </div>
  );
}

function SubscribeModal() {
  const { pendingSub, wallet, closeSubModal, confirmSub } = useApp();

  if (!pendingSub) return null;
  const agent = agentById(pendingSub.agentId);
  if (!agent) return null;
  const plan = agent.plans[pendingSub.planIdx];
  const payMethod = wallet ? `usdc · ${wallet.addr}` : "usdc · wallet";

  return (
    <div className="overlay" onClick={closeSubModal}>
      <div className="modal confirm" onClick={(e) => e.stopPropagation()}>
        <div className="kicker">{"// CONFIRM SUBSCRIPTION"}</div>
        <div className="modal-title roomy">
          {agent.name} · {plan.name}
        </div>
        <div className="confirm-rows">
          <div className="confirm-row">
            <span className="k">price</span>
            <span>${plan.price}/mo</span>
          </div>
          {plan.meter && (
            <div className="confirm-row">
              <span className="k">usage</span>
              <span className="meter">{plan.meter}</span>
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
          <button className="btn-cancel" onClick={closeSubModal}>
            cancel
          </button>
          <button className="btn-confirm" onClick={confirmSub}>
            confirm — ${plan.price}/mo
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
      <WalletModal />
      <OnboardModal />
      <SubscribeModal />
      <Toast />
    </>
  );
}
