import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arbitrum, arbitrumSepolia, mainnet } from "wagmi/chains";

// WalletConnect Cloud project id. Required for WalletConnect-based wallets
// (Rainbow, mobile wallets). Injected wallets like MetaMask work without it.
// Get one free at https://cloud.walletconnect.com and set NEXT_PUBLIC_WC_PROJECT_ID.
const projectId =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID || "DAEMON_DEV_PLACEHOLDER";

export const wagmiConfig = getDefaultConfig({
  appName: "Daemon",
  projectId,
  chains: [arbitrum, arbitrumSepolia, mainnet],
  ssr: true,
});

/** Truncate a wallet address to the `0x7A3f…C9f2` form used across the UI. */
export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
