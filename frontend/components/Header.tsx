"use client";

import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";

const SUB_TABS = [
  { href: "/", label: "Marketplace" },
  { href: "/subscriptions", label: "My subscriptions" },
];

const CRE_TABS = [
  { href: "/creator", label: "My agents" },
  { href: "/creator/register", label: "Register agent" },
  { href: "/creator/earnings", label: "Earnings" },
];

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { wallet, openWalletModal, disconnectWallet } = useApp();

  const isCreator = pathname.startsWith("/creator");
  const tabs = isCreator ? CRE_TABS : SUB_TABS;

  const tabActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname.startsWith("/agents");
    if (href === "/creator") return pathname === "/creator";
    return pathname === href;
  };

  return (
    <header className="header">
      <div className="header-inner">
        <div className="logo">
          <div className="logo-mark">&gt;_</div>
          <div className="logo-word">daemon</div>
        </div>

        <div className="role-switch">
          <button
            className={`role-btn${!isCreator ? " active" : ""}`}
            onClick={() => router.push("/")}
          >
            subscriber
          </button>
          <button
            className={`role-btn${isCreator ? " active" : ""}`}
            onClick={() => router.push("/creator")}
          >
            creator
          </button>
        </div>

        <nav className="nav">
          {tabs.map((t) => (
            <button
              key={t.href}
              className={`nav-tab${tabActive(t.href) ? " active" : ""}`}
              onClick={() => router.push(t.href)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="header-right">
          <a href="#" className="docs-link">
            docs ↗
          </a>
          {wallet ? (
            <button
              className="wallet-pill"
              title="Disconnect wallet"
              onClick={disconnectWallet}
            >
              <div className="dot" />
              {wallet.addr}
            </button>
          ) : (
            <button className="connect-btn" onClick={openWalletModal}>
              connect wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
