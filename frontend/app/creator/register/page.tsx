"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRegisterAgent } from "@/lib/api/hooks";
import { useApp } from "@/lib/store";
import type { AgentCategory, PricingModel, RegisterAgentInput } from "@/lib/api/types";

interface RegForm {
  name: string;
  cat: AgentCategory;
  desc: string;
  services: string;
  model: PricingModel;
  price: string;
  usage: string;
}

const INITIAL: RegForm = {
  name: "",
  cat: "finance",
  desc: "",
  services: "",
  model: "flat",
  price: "29",
  usage: "0.10",
};

const CATEGORIES: { value: AgentCategory; label: string }[] = [
  { value: "finance", label: "Finance" },
  { value: "productivity", label: "Productivity" },
  { value: "career", label: "Career" },
  { value: "engineering", label: "Engineering" },
  { value: "research", label: "Research" },
  { value: "other", label: "Other" },
];

const MODEL_OPTS: { key: PricingModel; label: string; hint: string }[] = [
  { key: "flat", label: "flat", hint: "Fixed $/mo" },
  { key: "usage", label: "usage", hint: "Pay per run" },
  { key: "hybrid", label: "hybrid", hint: "Base + per run" },
];

const STEP_LABELS = ["basics", "services + pricing", "review"];

export default function RegisterAgentPage() {
  const router = useRouter();
  const { wallet, openWalletModal, showToast } = useApp();
  const registerMut = useRegisterAgent();
  const [step, setStep] = useState(1);
  const [reg, setReg] = useState<RegForm>(INITIAL);

  const patch = (p: Partial<RegForm>) => setReg((r) => ({ ...r, ...p }));

  const chips = reg.services
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const priceSummary =
    reg.model === "flat"
      ? `$${reg.price || "0"}/mo flat`
      : reg.model === "usage"
        ? `$${reg.price || "0"}/mo min + $${reg.usage || "0"}/run`
        : `$${reg.price || "0"}/mo base + $${reg.usage || "0"}/run`;

  const catLabel = CATEGORIES.find((c) => c.value === reg.cat)?.label ?? reg.cat;

  const reviewRows = [
    { k: "NAME", v: reg.name || "—" },
    { k: "CATEGORY", v: catLabel },
    { k: "DESCRIPTION", v: reg.desc || "—" },
    { k: "SERVICES", v: chips.join(" · ") || "—" },
    { k: "PRICING", v: priceSummary },
  ];

  const publish = () => {
    if (!wallet) {
      openWalletModal();
      showToast("connect a wallet to publish");
      return;
    }
    const input: RegisterAgentInput = {
      user_address: wallet.address,
      name: reg.name.trim() || "Untitled agent",
      category: reg.cat,
      short_description: reg.desc,
      services: chips,
      pricing_model: reg.model,
      plans: [
        {
          name: "base",
          billing_interval: "monthly",
          base_price: { amount: reg.price || "0", currency: "USDC" },
          usage_price: reg.model !== "flat" ? { amount: reg.usage || "0", currency: "USDC" } : null,
          usage_unit: reg.model !== "flat" ? "run" : null,
          description: reg.desc || "",
        },
      ],
    };
    registerMut.mutate(input, {
      onSuccess: (data) => {
        setReg(INITIAL);
        setStep(1);
        router.push("/creator");
        showToast(`${data.agent.name} is live in the marketplace`);
      },
      onError: (e) => showToast(e instanceof Error ? e.message : "couldn’t publish agent"),
    });
  };

  return (
    <div className="register-wrap">
      <div className="page-head">
        <div className="kicker">{"// REGISTER AGENT"}</div>
        <h1 className="page-title">List your agent</h1>
        <p className="page-sub">Three steps. You can edit everything after publishing.</p>
      </div>

      <div className="steps">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={label} className={`step${active || done ? " on" : ""}${active ? " here" : ""}`}>
              <div className="step-circle">{done ? "✓" : n}</div>
              <div className="step-label">{label}</div>
              {n < 3 && <div className="step-tail" />}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div className="form-stack">
          <div className="field">
            <label className="field-label">AGENT NAME</label>
            <input
              className="input"
              value={reg.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Nightwatch"
            />
          </div>
          <div className="field">
            <label className="field-label">CATEGORY</label>
            <select
              className="input"
              value={reg.cat}
              onChange={(e) => patch({ cat: e.target.value as AgentCategory })}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">WHAT DOES IT DO?</label>
            <textarea
              className="input"
              rows={3}
              value={reg.desc}
              onChange={(e) => patch({ desc: e.target.value })}
              placeholder="One or two sentences subscribers will see on your card."
            />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="form-stack">
          <div className="field">
            <label className="field-label">
              SERVICES OFFERED <span className="hint">(comma-separated)</span>
            </label>
            <input
              className="input"
              value={reg.services}
              onChange={(e) => patch({ services: e.target.value })}
              placeholder="e.g. uptime checks, alerting, weekly report"
            />
            {chips.length > 0 && (
              <div className="chip-row reg-chips">
                {chips.map((ch) => (
                  <div key={ch} className="chip">
                    {ch}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label className="field-label">
              PRICING MODEL <span className="hint">(you choose — daemon supports all three)</span>
            </label>
            <div className="model-grid">
              {MODEL_OPTS.map((m) => (
                <button
                  key={m.key}
                  className={`model-opt${reg.model === m.key ? " on" : ""}`}
                  onClick={() => patch({ model: m.key })}
                >
                  <div className="model-opt-label">{m.label}</div>
                  <div className="model-opt-hint">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="price-grid">
            <div className="field">
              <label className="field-label">BASE PRICE ($/MO)</label>
              <input
                className="input mono-input"
                value={reg.price}
                onChange={(e) => patch({ price: e.target.value })}
              />
            </div>
            {reg.model !== "flat" && (
              <div className="field">
                <label className="field-label">USAGE PRICE ($/RUN)</label>
                <input
                  className="input mono-input"
                  value={reg.usage}
                  onChange={(e) => patch({ usage: e.target.value })}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="review-card">
          {reviewRows.map((row) => (
            <div key={row.k} className="review-row">
              <div className="review-key">{row.k}</div>
              <div className="review-val">{row.v}</div>
            </div>
          ))}
          <div className="review-note">
            Publishing lists your agent in the marketplace immediately. daemon takes 10% of
            each subscription; payouts run every Friday.
          </div>
        </div>
      )}

      <div className="reg-actions">
        {step > 1 && (
          <button className="btn-back" onClick={() => setStep(step - 1)} disabled={registerMut.isPending}>
            ← back
          </button>
        )}
        <button
          className="btn-next"
          disabled={registerMut.isPending}
          onClick={() => (step === 3 ? publish() : setStep(step + 1))}
        >
          {step === 3
            ? registerMut.isPending
              ? "publishing…"
              : "publish agent →"
            : "continue →"}
        </button>
      </div>
    </div>
  );
}
