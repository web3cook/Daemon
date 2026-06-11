export interface Plan {
  name: string;
  price: number;
  meter?: string;
  detail: string;
}

export interface Agent {
  id: string;
  name: string;
  av: string;
  tag: string;
  rating: string;
  subsCount: string;
  publisher: string;
  model: string;
  desc: string;
  longDesc: string;
  services: string[];
  plans: Plan[];
}

export interface WalletDef {
  id: string;
  name: string;
  ic: string;
  bg: string;
}

export const WALLETS: WalletDef[] = [
  { id: "rainbow", name: "Rainbow", ic: "R", bg: "#4C82FB" },
  { id: "metamask", name: "MetaMask", ic: "M", bg: "#F6851B" },
  { id: "coinbase", name: "Coinbase Wallet", ic: "C", bg: "#2C5FF6" },
  { id: "walletconnect", name: "WalletConnect", ic: "W", bg: "#3B99FC" },
  { id: "phantom", name: "Phantom", ic: "P", bg: "#AB9FF2" },
];

export const AGENTS: Agent[] = [
  {
    id: "pulse",
    name: "Pulse",
    av: "pu",
    tag: "dca-agent",
    rating: "4.8",
    subsCount: "1.2k",
    publisher: "Meridian Labs",
    model: "flat tiers",
    desc: "Dollar-cost averages into your portfolio on a schedule you set — no charts, no stress.",
    longDesc:
      "Pulse executes a disciplined dollar-cost averaging strategy across the assets you pick. Set a schedule and a budget; it buys through your linked brokerage, rebalances drift, and sends a plain-language summary after every run.",
    services: ["auto-dca", "rebalance", "alerts"],
    plans: [
      { name: "starter", price: 19, detail: "1 portfolio · weekly buys · email summaries" },
      { name: "pro", price: 49, detail: "5 portfolios · daily buys · auto-rebalancing · priority runs" },
    ],
  },
  {
    id: "tidy",
    name: "Tidy",
    av: "ti",
    tag: "organiser-agent",
    rating: "4.7",
    subsCount: "3.4k",
    publisher: "Northbeam",
    model: "flat tiers",
    desc: "Keeps your inbox, calendar and task list in order — triages, schedules and reminds.",
    longDesc:
      "Tidy connects to your email and calendar, triages what arrives, schedules what needs a slot, and keeps a running task list it actually maintains. Every morning you get a one-screen brief of what it did and what needs you.",
    services: ["inbox-triage", "scheduling", "tasks"],
    plans: [
      { name: "standard", price: 12, detail: "1 inbox + 1 calendar · daily brief" },
      { name: "plus", price: 25, detail: "3 inboxes · shared calendars · family/team tasks" },
    ],
  },
  {
    id: "pathfinder",
    name: "Pathfinder",
    av: "pf",
    tag: "jobfinder-agent",
    rating: "4.9",
    subsCount: "860",
    publisher: "Coldfront",
    model: "hybrid",
    desc: "Hunts job boards overnight, tailors your CV per role and tracks every application.",
    longDesc:
      "Pathfinder scans boards and company pages overnight against your profile, ranks matches, tailors your CV and cover letter per role, and submits with your approval — then tracks every application through to reply.",
    services: ["job-match", "cv-tailor", "tracking"],
    plans: [
      {
        name: "searcher",
        price: 24,
        meter: "+ $0.50 / application",
        detail: "Unlimited matching · pay per tailored application",
      },
      { name: "all-in", price: 59, detail: "Everything included · unlimited applications" },
    ],
  },
  {
    id: "clerk",
    name: "Clerk",
    av: "cl",
    tag: "bookkeeping-agent",
    rating: "4.6",
    subsCount: "640",
    publisher: "Quietbooks",
    model: "usage-based",
    desc: "Categorizes transactions, reconciles monthly and hands your accountant clean books.",
    longDesc:
      "Clerk watches your business accounts, categorizes every transaction against your chart of accounts, reconciles at month end, and exports accountant-ready books.",
    services: ["categorize", "reconcile", "exports"],
    plans: [
      {
        name: "metered",
        price: 9,
        meter: "+ $0.04 / transaction",
        detail: "Pay for what it processes · monthly close included",
      },
      { name: "flat", price: 79, detail: "Unlimited transactions · quarterly review call" },
    ],
  },
  {
    id: "scribe",
    name: "Scribe",
    av: "sc",
    tag: "notes-agent",
    rating: "4.7",
    subsCount: "2.1k",
    publisher: "Stanza",
    model: "flat",
    desc: "Joins your meetings, writes decisions-first notes and chases the action items.",
    longDesc:
      "Scribe sits in on your calls, produces decisions-first notes within minutes, and follows up on action items with owners until they're done or escalated.",
    services: ["meeting-notes", "action-items", "follow-ups"],
    plans: [
      { name: "solo", price: 15, detail: "10 meetings/mo · notes + action items" },
      { name: "team", price: 45, detail: "Unlimited meetings · shared workspace · integrations" },
    ],
  },
  {
    id: "watchdog",
    name: "Watchdog",
    av: "wd",
    tag: "monitor-agent",
    rating: "4.8",
    subsCount: "990",
    publisher: "Stackwatch",
    model: "flat tiers",
    desc: "Watches your sites and APIs, fixes routine incidents and writes the post-mortem.",
    longDesc:
      "Watchdog monitors uptime and performance, handles routine remediations like restarts and rollbacks autonomously, and posts a clear post-mortem to your channel after every incident.",
    services: ["uptime", "auto-fix", "post-mortems"],
    plans: [
      { name: "basic", price: 29, detail: "5 endpoints · auto-restart · status page" },
      { name: "fleet", price: 89, detail: "50 endpoints · rollbacks · on-call escalation" },
    ],
  },
];

export const USAGE_MAP: Record<string, string> = {
  pulse: "8 buys executed this month",
  tidy: "412 emails triaged this month",
  pathfinder: "14 applications submitted",
  clerk: "1,038 transactions processed",
  scribe: "9 meetings covered",
  watchdog: "99.98% uptime · 2 auto-fixes",
};

export function agentById(id: string): Agent | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function fromPrice(agent: Agent): number {
  return Math.min(...agent.plans.map((p) => p.price));
}
