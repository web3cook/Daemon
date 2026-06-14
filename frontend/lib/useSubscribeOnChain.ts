"use client";

import { useCallback, useState } from "react";
import { erc20Abi, maxUint160, maxUint256, parseEventLogs } from "viem";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  CONTRACT_CHAIN,
  PERMIT2_ADDRESS,
  SUBSCRIPTIONS_ADDRESS,
  USDC_ADDRESS,
  permit2Abi,
  permit2Types,
  subscriptionsAbi,
} from "./contracts";
import { getGasFees } from "./gas";

export type SubscribePhase =
  | "idle"
  | "switching"
  | "approving"
  | "permit"
  | "subscribing";

export const SUBSCRIBE_PHASE_LABEL: Record<Exclude<SubscribePhase, "idle">, string> = {
  switching: "switching network…",
  approving: "approving usdc…",
  permit: "sign permit in wallet…",
  subscribing: "subscribing on-chain…",
};

export interface OnChainSubscription {
  subscriptionId: `0x${string}`;
  txHash: `0x${string}`;
}

/**
 * Runs the full on-chain subscribe flow against Subscriptions on Arbitrum
 * Sepolia:
 *   1. one-time USDC approval to Permit2 (skipped if allowance suffices)
 *   2. EIP-712 PermitSingle signature authorising Subscriptions to pull USDC
 *   3. Subscriptions.subscribe() returns the id from SubscriptionCreated
 */
export function useSubscribeOnChain() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient({ chainId: CONTRACT_CHAIN.id });
  const [phase, setPhase] = useState<SubscribePhase>("idle");

  const subscribeOnChain = useCallback(
    async (
      serviceAddress: `0x${string}`,
      amountPerCycle: bigint,
      intervalSecs: number,
      durationSecs: number,
      paramsHex: `0x${string}` = "0x",
    ): Promise<OnChainSubscription> => {
      if (!address) throw new Error("wallet not connected");
      if (!SUBSCRIPTIONS_ADDRESS || !USDC_ADDRESS) {
        throw new Error("contract addresses not configured: set NEXT_PUBLIC_SUBSCRIPTIONS_ADDRESS");
      }
      if (!publicClient) throw new Error("no RPC client for Arbitrum Sepolia");

      try {
        if (chainId !== CONTRACT_CHAIN.id) {
          setPhase("switching");
          await switchChainAsync({ chainId: CONTRACT_CHAIN.id });
        }

        const now = Math.floor(Date.now() / 1000);
        // permitExpiry bounds the subscription to the duration the subscriber
        // chose. 5-min buffer matches the contracts' Subscribe script so a
        // later permit can't cut an earlier subscription's window short.
        const permitExpiry = now + durationSecs + 300;
        const cycles = BigInt(Math.floor(durationSecs / intervalSecs) + 1);

        // 1. One-time ERC20 approval so Permit2 can move the user's USDC.
        const allowance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, PERMIT2_ADDRESS],
        });
        if (allowance < amountPerCycle * cycles) {
          setPhase("approving");
          const approveHash = await writeContractAsync({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: "approve",
            args: [PERMIT2_ADDRESS, maxUint256],
            chainId: CONTRACT_CHAIN.id,
            ...(await getGasFees(publicClient)),
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        // 2. Sign the Permit2 PermitSingle. Amount is uint160 max so the
        // shared (owner, token, spender) allowance slot is never depleted
        // by concurrent subscriptions; expiry bounds the subscription.
        setPhase("permit");
        const [, , nonce] = await publicClient.readContract({
          address: PERMIT2_ADDRESS,
          abi: permit2Abi,
          functionName: "allowance",
          args: [address, USDC_ADDRESS, SUBSCRIPTIONS_ADDRESS],
        });
        const permitSingle = {
          details: {
            token: USDC_ADDRESS,
            amount: maxUint160,
            expiration: permitExpiry,
            nonce,
          },
          spender: SUBSCRIPTIONS_ADDRESS,
          sigDeadline: BigInt(now + 30 * 60),
        };
        const signature = await signTypedDataAsync({
          domain: {
            name: "Permit2",
            chainId: CONTRACT_CHAIN.id,
            verifyingContract: PERMIT2_ADDRESS,
          },
          types: permit2Types,
          primaryType: "PermitSingle",
          message: permitSingle,
        });

        // 3. subscribe(): paramsHex carries the subscriber's answers to the
        // agent's required inputs. Service.userRegistered() stores them and
        // emits UserRegistered(subscriber, params) on-chain.
        setPhase("subscribing");
        const hash = await writeContractAsync({
          address: SUBSCRIPTIONS_ADDRESS,
          abi: subscriptionsAbi,
          functionName: "subscribe",
          chainId: CONTRACT_CHAIN.id,
          ...(await getGasFees(publicClient)),
          args: [
            serviceAddress,
            USDC_ADDRESS,
            amountPerCycle,
            BigInt(intervalSecs),
            permitSingle,
            signature,
            paramsHex,
          ],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const [created] = parseEventLogs({
          abi: subscriptionsAbi,
          eventName: "SubscriptionCreated",
          logs: receipt.logs,
        });
        if (!created) throw new Error("SubscriptionCreated event not found in receipt");

        return { subscriptionId: created.args.id, txHash: hash };
      } finally {
        setPhase("idle");
      }
    },
    [address, chainId, publicClient, signTypedDataAsync, switchChainAsync, writeContractAsync],
  );

  return { subscribeOnChain, phase };
}
