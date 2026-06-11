"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { agentById, WALLETS, type WalletDef } from "./agents";

export type Role = "sub" | "cre";

export interface Wallet {
  addr: string;
  name: string;
}

export interface PublishedAgent {
  name: string;
  av: string;
  tag: string;
}

export interface PendingSub {
  agentId: string;
  planIdx: number;
}

interface AppState {
  wallet: Wallet | null;
  walletModalOpen: boolean;
  connecting: WalletDef | null;
  onboardOpen: boolean;
  subs: Record<string, string>;
  published: PublishedAgent[];
  toast: string;
  pendingSub: PendingSub | null;
  openWalletModal: () => void;
  closeWalletModal: () => void;
  connectWallet: (w: WalletDef) => void;
  cancelConnecting: () => void;
  disconnectWallet: () => void;
  finishOnboard: (handle: string, role: Role) => void;
  requestSubscribe: (agentId: string, planIdx: number) => void;
  closeSubModal: () => void;
  confirmSub: () => void;
  cancelSub: (agentId: string) => void;
  publishAgent: (agent: PublishedAgent) => void;
  showToast: (msg: string) => void;
}

const DEMO_ADDR = "0x7A3f…C9f2";

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [connecting, setConnecting] = useState<WalletDef | null>(null);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [subs, setSubs] = useState<Record<string, string>>({ tidy: "standard" });
  const [published, setPublished] = useState<PublishedAgent[]>([]);
  const [toast, setToast] = useState("");
  const [pendingSub, setPendingSub] = useState<PendingSub | null>(null);
  const hasOnboarded = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const openWalletModal = useCallback(() => {
    setConnecting(null);
    setWalletModalOpen(true);
  }, []);

  const closeWalletModal = useCallback(() => {
    clearTimeout(connectTimer.current);
    setConnecting(null);
    setWalletModalOpen(false);
  }, []);

  const connectWallet = useCallback(
    (w: WalletDef) => {
      setConnecting(w);
      clearTimeout(connectTimer.current);
      connectTimer.current = setTimeout(() => {
        const firstTime = !hasOnboarded.current;
        setWallet({ addr: DEMO_ADDR, name: w.name });
        setConnecting(null);
        setWalletModalOpen(false);
        if (firstTime) {
          setOnboardOpen(true);
        } else {
          showToast(`wallet connected · ${DEMO_ADDR}`);
        }
      }, 1400);
    },
    [showToast],
  );

  const cancelConnecting = useCallback(() => {
    clearTimeout(connectTimer.current);
    setConnecting(null);
  }, []);

  const disconnectWallet = useCallback(() => {
    setWallet(null);
    showToast("wallet disconnected");
  }, [showToast]);

  const finishOnboard = useCallback(
    (handle: string, role: Role) => {
      hasOnboarded.current = true;
      const clean = handle.trim().replace(/^@/, "") || "anon";
      setOnboardOpen(false);
      router.push(role === "sub" ? "/" : "/creator");
      showToast(`welcome, @${clean} — wallet linked`);
    },
    [router, showToast],
  );

  const requestSubscribe = useCallback(
    (agentId: string, planIdx: number) => {
      if (!wallet) {
        openWalletModal();
        showToast("connect a wallet to subscribe");
        return;
      }
      setPendingSub({ agentId, planIdx });
    },
    [wallet, openWalletModal, showToast],
  );

  const closeSubModal = useCallback(() => setPendingSub(null), []);

  const confirmSub = useCallback(() => {
    if (!pendingSub) return;
    const agent = agentById(pendingSub.agentId);
    if (!agent) return;
    const plan = agent.plans[pendingSub.planIdx];
    setSubs((s) => ({ ...s, [agent.id]: plan.name }));
    setPendingSub(null);
    router.push("/subscriptions");
    showToast(`Subscribed to ${agent.name} · ${plan.name}`);
  }, [pendingSub, router, showToast]);

  const cancelSub = useCallback(
    (agentId: string) => {
      const agent = agentById(agentId);
      setSubs((s) => {
        const next = { ...s };
        delete next[agentId];
        return next;
      });
      showToast(`Cancelled ${agent?.name ?? agentId} — active until Jul 1`);
    },
    [showToast],
  );

  const publishAgent = useCallback(
    (agent: PublishedAgent) => {
      setPublished((p) => [...p, agent]);
      router.push("/creator");
      showToast(`${agent.name} is live in the marketplace`);
    },
    [router, showToast],
  );

  const value = useMemo<AppState>(
    () => ({
      wallet,
      walletModalOpen,
      connecting,
      onboardOpen,
      subs,
      published,
      toast,
      pendingSub,
      openWalletModal,
      closeWalletModal,
      connectWallet,
      cancelConnecting,
      disconnectWallet,
      finishOnboard,
      requestSubscribe,
      closeSubModal,
      confirmSub,
      cancelSub,
      publishAgent,
      showToast,
    }),
    [
      wallet,
      walletModalOpen,
      connecting,
      onboardOpen,
      subs,
      published,
      toast,
      pendingSub,
      openWalletModal,
      closeWalletModal,
      connectWallet,
      cancelConnecting,
      disconnectWallet,
      finishOnboard,
      requestSubscribe,
      closeSubModal,
      confirmSub,
      cancelSub,
      publishAgent,
      showToast,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export { WALLETS };
