"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { parseUnits } from "viem";
import { shortenAddress } from "./wagmi";
import { ApiError } from "./api/client";
import { useCancelSubscription, useOnboard, useSubscribe } from "./api/hooks";
import { USDC_DECIMALS, billingIntervalSeconds } from "./contracts";
import { SUBSCRIBE_PHASE_LABEL, useSubscribeOnChain } from "./useSubscribeOnChain";
import type { BillingInterval, Money } from "./api/types";

export type Role = "sub" | "cre";

export interface Wallet {
  /** Truncated display form, e.g. `0x7A3f…C9f2`. */
  addr: string;
  /** Full checksummed address. */
  address: string;
  /** Connector name, e.g. "MetaMask". */
  name: string;
}

export interface PendingSub {
  agentId: string;
  agentName: string;
  /** Agent's Service contract — target of the on-chain subscribe. */
  serviceAddress: string;
  planId: string;
  planName: string;
  billingInterval: BillingInterval;
  price: Money;
  meter: string;
}

interface AppState {
  wallet: Wallet | null;
  onboardOpen: boolean;
  onboardPending: boolean;
  toast: string;
  pendingSub: PendingSub | null;
  subscribePending: boolean;
  /** Progress label while the on-chain + backend subscribe flow runs. */
  subscribePhase: string | null;
  openWalletModal: () => void;
  disconnectWallet: () => void;
  finishOnboard: (handle: string, role: Role) => void;
  requestSubscribe: (sub: PendingSub) => void;
  closeSubModal: () => void;
  confirmSub: () => void;
  cancelSub: (subscriptionId: string, agentName: string) => void;
  showToast: (msg: string) => void;
}

const AppContext = createContext<AppState | null>(null);

const onboardedKey = (address: string) => `daemon:onboarded:${address.toLowerCase()}`;

function errMessage(e: unknown, fallback: string): string {
  // viem/wagmi errors carry a human-sized shortMessage; prefer it.
  if (e && typeof e === "object" && "shortMessage" in e) {
    return String((e as { shortMessage: unknown }).shortMessage);
  }
  if (e instanceof ApiError || e instanceof Error) return e.message;
  return fallback;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { address, isConnected, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const subscribeMut = useSubscribe();
  const cancelMut = useCancelSubscription();
  const onboardMut = useOnboard();
  const { subscribeOnChain, phase: txPhase } = useSubscribeOnChain();

  const [onboardOpen, setOnboardOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [pendingSub, setPendingSub] = useState<PendingSub | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevConnected = useRef(false);

  const wallet = useMemo<Wallet | null>(
    () =>
      isConnected && address
        ? { addr: shortenAddress(address), address, name: connector?.name ?? "wallet" }
        : null,
    [isConnected, address, connector],
  );

  const showToast = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  // When a wallet connects, run onboarding the first time we see this address,
  // otherwise just confirm the connection. Persisted so reload/reconnect is quiet.
  useEffect(() => {
    const justConnected = isConnected && !prevConnected.current;
    prevConnected.current = isConnected;
    if (!justConnected || !address) return;

    const seen =
      typeof window !== "undefined" && localStorage.getItem(onboardedKey(address));
    if (seen) {
      showToast(`wallet connected · ${shortenAddress(address)}`);
    } else {
      setOnboardOpen(true);
    }
  }, [isConnected, address, showToast]);

  const openWalletModal = useCallback(() => {
    openConnectModal?.();
  }, [openConnectModal]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    setOnboardOpen(false);
    showToast("wallet disconnected");
  }, [disconnect, showToast]);

  const finishOnboard = useCallback(
    (handle: string, role: Role) => {
      if (!address) return;
      const clean = handle.trim().replace(/^@/, "") || "anon";
      onboardMut.mutate(
        { address, handle: clean, role: role === "sub" ? "subscriber" : "creator" },
        {
          onSuccess: () => {
            if (typeof window !== "undefined") {
              localStorage.setItem(onboardedKey(address), "1");
            }
            setOnboardOpen(false);
            router.push(role === "sub" ? "/" : "/creator");
            showToast(`welcome, @${clean} — wallet linked`);
          },
          onError: (e) => showToast(errMessage(e, "couldn’t complete onboarding")),
        },
      );
    },
    [address, onboardMut, router, showToast],
  );

  const requestSubscribe = useCallback(
    (sub: PendingSub) => {
      if (!wallet) {
        openWalletModal();
        showToast("connect a wallet to subscribe");
        return;
      }
      setPendingSub(sub);
    },
    [wallet, openWalletModal, showToast],
  );

  const closeSubModal = useCallback(() => setPendingSub(null), []);

  const confirmSub = useCallback(async () => {
    if (!pendingSub || !address) return;

    // 1. On-chain: approve USDC → sign Permit2 → Subscriptions.subscribe().
    let subscriptionId: string;
    let txHash: string;
    try {
      const onchain = await subscribeOnChain(
        pendingSub.serviceAddress as `0x${string}`,
        parseUnits(pendingSub.price.amount, USDC_DECIMALS),
        billingIntervalSeconds(pendingSub.billingInterval),
      );
      subscriptionId = onchain.subscriptionId;
      txHash = onchain.txHash;
    } catch (e) {
      showToast(errMessage(e, "subscription failed"));
      return;
    }

    // 2. Backend: record the subscription with its on-chain id.
    subscribeMut.mutate(
      {
        address,
        agentId: pendingSub.agentId,
        planId: pendingSub.planId,
        subscriptionId,
        txHash,
      },
      {
        onSuccess: () => {
          const name = pendingSub.agentName;
          const plan = pendingSub.planName;
          setPendingSub(null);
          router.push("/subscriptions");
          showToast(`Subscribed to ${name} · ${plan}`);
        },
        onError: (e) => showToast(errMessage(e, "subscription failed")),
      },
    );
  }, [pendingSub, address, subscribeOnChain, subscribeMut, router, showToast]);

  const cancelSub = useCallback(
    (subscriptionId: string, agentName: string) => {
      if (!address) return;
      cancelMut.mutate(
        { subscriptionId, address },
        {
          onSuccess: () => showToast(`Cancelled ${agentName} — active until period end`),
          onError: (e) => showToast(errMessage(e, "couldn’t cancel")),
        },
      );
    },
    [address, cancelMut, showToast],
  );

  const subscribePhase =
    txPhase !== "idle"
      ? SUBSCRIBE_PHASE_LABEL[txPhase]
      : subscribeMut.isPending
        ? "saving subscription…"
        : null;

  const value = useMemo<AppState>(
    () => ({
      wallet,
      onboardOpen,
      onboardPending: onboardMut.isPending,
      toast,
      pendingSub,
      subscribePending: subscribePhase !== null,
      subscribePhase,
      openWalletModal,
      disconnectWallet,
      finishOnboard,
      requestSubscribe,
      closeSubModal,
      confirmSub,
      cancelSub,
      showToast,
    }),
    [
      wallet,
      onboardOpen,
      onboardMut.isPending,
      toast,
      pendingSub,
      subscribePhase,
      openWalletModal,
      disconnectWallet,
      finishOnboard,
      requestSubscribe,
      closeSubModal,
      confirmSub,
      cancelSub,
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
