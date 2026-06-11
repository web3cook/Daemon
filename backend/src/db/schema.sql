-- Daemon API v1 — PostgreSQL schema
-- Run via `npm run db:migrate` (src/db/migrate.ts)

CREATE TABLE IF NOT EXISTS users (
  user_id      TEXT PRIMARY KEY,
  user_address TEXT UNIQUE NOT NULL,
  handle       TEXT UNIQUE,
  roles        TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  user_address TEXT PRIMARY KEY,
  nonce        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id           TEXT PRIMARY KEY,
  slug               TEXT UNIQUE NOT NULL,
  name               TEXT NOT NULL,
  icon               TEXT,
  logo               TEXT,
  category           TEXT NOT NULL,
  tagline            TEXT,
  short_description  TEXT,
  description        TEXT,
  services           TEXT[] NOT NULL DEFAULT '{}',
  rating             NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count       INT NOT NULL DEFAULT 0,
  base_subscriber_count INT NOT NULL DEFAULT 0,
  publisher_name     TEXT,
  publisher_user_id  TEXT REFERENCES users(user_id),
  pricing_model      TEXT NOT NULL DEFAULT 'flat',
  status             TEXT NOT NULL DEFAULT 'live',
  onchain            BOOLEAN NOT NULL DEFAULT false,
  usage_label        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  plan_id             TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  billing_interval    TEXT NOT NULL,
  base_price_amount   NUMERIC(18,6) NOT NULL,
  base_price_currency TEXT NOT NULL DEFAULT 'USDC',
  usage_price_amount  NUMERIC(18,6),
  usage_unit          TEXT,
  description         TEXT,
  sort_order          INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  agent_id            TEXT NOT NULL REFERENCES agents(agent_id),
  plan_id             TEXT NOT NULL REFERENCES plans(plan_id),
  status              TEXT NOT NULL DEFAULT 'active',
  onchain_sub_id      TEXT,
  usage_count         INT NOT NULL DEFAULT 0,
  last_payment_amount   NUMERIC(18,6),
  last_payment_currency TEXT DEFAULT 'USDC',
  last_payment_time     TIMESTAMPTZ,
  next_payment_amount   NUMERIC(18,6),
  next_payment_currency TEXT DEFAULT 'USDC',
  next_payment_time     TIMESTAMPTZ,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at        TIMESTAMPTZ,
  UNIQUE (user_id, agent_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  invoice_id      TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  description     TEXT,
  amount          NUMERIC(18,6) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USDC',
  status          TEXT NOT NULL DEFAULT 'paid',
  tx_hash         TEXT,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payouts (
  payout_id  TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  amount     NUMERIC(18,6) NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'USDC',
  status     TEXT NOT NULL DEFAULT 'paid',
  tx_hash    TEXT,
  payout_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS base_subscriber_count INT NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS usage_count INT NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE plans ADD CONSTRAINT plans_agent_id_name_key UNIQUE (agent_id, name);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_agent ON plans(agent_id);
