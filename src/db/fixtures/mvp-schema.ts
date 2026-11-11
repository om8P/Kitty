/**
 * Frozen copy of the schema the MVP created at startup (before S19). The
 * migration tests build a database from it, to prove the migrations upgrade an
 * MVP-made database without losing anything. Never edit it.
 */
export const MVP_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member'))
  )`,
  `CREATE TABLE IF NOT EXISTS pools (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    goal TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'awaiting_payer', 'active', 'closing', 'closed', 'abandoned')),
    term_days INTEGER NOT NULL CHECK (term_days BETWEEN 1 AND 28),
    ends_at TIMESTAMPTZ NOT NULL,
    rail TEXT NOT NULL,
    requested_cents INTEGER NOT NULL CHECK (requested_cents > 0),
    authorized_cents INTEGER NOT NULL DEFAULT 0 CHECK (authorized_cents >= 0),
    reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
    captured_cents INTEGER NOT NULL DEFAULT 0 CHECK (captured_cents >= 0),
    refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
    released_cents INTEGER NOT NULL DEFAULT 0 CHECK (released_cents >= 0),
    paypal_order_id TEXT UNIQUE,
    authorization_id TEXT,
    hold_expires_at TIMESTAMPTZ,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    CONSTRAINT pools_never_overspent CHECK (reserved_cents + captured_cents + released_cents <= authorized_cents),
    CONSTRAINT pools_refund_within_captured CHECK (refunded_cents <= captured_cents)
  )`,
  `CREATE TABLE IF NOT EXISTS pool_members (
    id TEXT PRIMARY KEY,
    pool_id TEXT NOT NULL REFERENCES pools(id),
    kind TEXT NOT NULL CHECK (kind IN ('person', 'agent')),
    user_id TEXT REFERENCES users(id),
    label TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    limit_cents INTEGER NOT NULL CHECK (limit_cents >= 0),
    approval_threshold_cents INTEGER NOT NULL CHECK (approval_threshold_cents >= 0),
    allowed_stores JSONB NOT NULL,
    reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
    captured_cents INTEGER NOT NULL DEFAULT 0 CHECK (captured_cents >= 0),
    position INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT members_never_over_limit CHECK (reserved_cents + captured_cents <= limit_cents)
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('seed', 'channel3')),
    external_id TEXT NOT NULL,
    store TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    pool_id TEXT NOT NULL REFERENCES pools(id),
    member_id TEXT NOT NULL REFERENCES pool_members(id),
    task TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'finished', 'failed')),
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_one_open_per_member
    ON agent_runs (member_id) WHERE status = 'running'`,
  `CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    pool_id TEXT NOT NULL REFERENCES pools(id),
    member_id TEXT NOT NULL REFERENCES pool_members(id),
    product_id TEXT NOT NULL,
    product_title TEXT NOT NULL,
    store TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    status TEXT NOT NULL CHECK (status IN (
      'rejected_by_rules', 'reviewing', 'blocked_by_ai', 'awaiting_approval', 'denied', 'expired',
      'capturing', 'captured', 'capture_failed', 'capture_unknown', 'refund_pending', 'refunded'
    )),
    rule_code TEXT,
    message TEXT,
    ai_decision TEXT,
    ai_reason TEXT,
    approval_reason TEXT,
    authorization_id TEXT,
    capture_id TEXT,
    refund_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    agent_run_id TEXT REFERENCES agent_runs(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS purchases_by_pool ON purchases (pool_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    pool_id TEXT NOT NULL REFERENCES pools(id),
    member_id TEXT REFERENCES pool_members(id),
    purchase_id TEXT REFERENCES purchases(id),
    kind TEXT NOT NULL CHECK (kind IN ('authorize', 'reserve', 'release', 'capture', 'refund', 'void')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS usage_counters (
    kind TEXT NOT NULL,
    period TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, period)
  )`,
];
