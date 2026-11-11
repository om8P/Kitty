/**
 * The database schema in Drizzle (architecture 2 and 6, ADR-0010). Migrations
 * in `drizzle/` are generated from this file with `npm run db:generate` and
 * reviewed as SQL. Money is integer cents.
 *
 * The CHECK constraints are the last line of defense against overspending:
 * Postgres refuses any row where a pool or a member would hold more than it
 * was given (architecture 7.1).
 *
 * Constraint names are spelled out and match what Postgres named the MVP's
 * inline constraints, so a database the MVP made and one built from the
 * migrations are the same, and later migrations can refer to them by name.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const households = pgTable("households", {
  id: text("id").primaryKey(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
  },
  (t) => [
    foreignKey({ name: "users_household_id_fkey", columns: [t.householdId], foreignColumns: [households.id] }),
    check("users_role_check", sql`${t.role} IN ('owner', 'member')`),
  ],
);

export const pools = pgTable(
  "pools",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    goal: text("goal").notNull(),
    status: text("status").notNull(),
    termDays: integer("term_days").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    rail: text("rail").notNull(),
    requestedCents: integer("requested_cents").notNull(),
    authorizedCents: integer("authorized_cents").notNull().default(0),
    reservedCents: integer("reserved_cents").notNull().default(0),
    capturedCents: integer("captured_cents").notNull().default(0),
    refundedCents: integer("refunded_cents").notNull().default(0),
    releasedCents: integer("released_cents").notNull().default(0),
    paypalOrderId: text("paypal_order_id"),
    /** The current PayPal authorization. Its history is in `authorizations`. */
    authorizationId: text("authorization_id"),
    holdExpiresAt: timestamptz("hold_expires_at"),
    note: text("note"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    closedAt: timestamptz("closed_at"),
  },
  (t) => [
    foreignKey({ name: "pools_household_id_fkey", columns: [t.householdId], foreignColumns: [households.id] }),
    foreignKey({ name: "pools_owner_user_id_fkey", columns: [t.ownerUserId], foreignColumns: [users.id] }),
    unique("pools_paypal_order_id_key").on(t.paypalOrderId),
    check(
      "pools_status_check",
      sql`${t.status} IN ('draft', 'awaiting_payer', 'active', 'closing', 'closed', 'abandoned')`,
    ),
    check("pools_term_days_check", sql`${t.termDays} BETWEEN 1 AND 28`),
    check("pools_requested_cents_check", sql`${t.requestedCents} > 0`),
    check("pools_authorized_cents_check", sql`${t.authorizedCents} >= 0`),
    check("pools_reserved_cents_check", sql`${t.reservedCents} >= 0`),
    check("pools_captured_cents_check", sql`${t.capturedCents} >= 0`),
    check("pools_refunded_cents_check", sql`${t.refundedCents} >= 0`),
    check("pools_released_cents_check", sql`${t.releasedCents} >= 0`),
    check(
      "pools_never_overspent",
      sql`${t.reservedCents} + ${t.capturedCents} + ${t.releasedCents} <= ${t.authorizedCents}`,
    ),
    check("pools_refund_within_captured", sql`${t.refundedCents} <= ${t.capturedCents}`),
  ],
);

export const poolMembers = pgTable(
  "pool_members",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id").notNull(),
    kind: text("kind").notNull(),
    userId: text("user_id"),
    label: text("label").notNull(),
    active: boolean("active").notNull().default(true),
    limitCents: integer("limit_cents").notNull(),
    approvalThresholdCents: integer("approval_threshold_cents").notNull(),
    reservedCents: integer("reserved_cents").notNull().default(0),
    capturedCents: integer("captured_cents").notNull().default(0),
    position: integer("position").notNull().default(0),
    /** Refunded money stays used against the limit (architecture 7.3). */
    refundedCents: integer("refunded_cents").notNull().default(0),
  },
  (t) => [
    foreignKey({ name: "pool_members_pool_id_fkey", columns: [t.poolId], foreignColumns: [pools.id] }),
    foreignKey({ name: "pool_members_user_id_fkey", columns: [t.userId], foreignColumns: [users.id] }),
    check("pool_members_kind_check", sql`${t.kind} IN ('person', 'agent')`),
    check("pool_members_limit_cents_check", sql`${t.limitCents} >= 0`),
    check("pool_members_approval_threshold_cents_check", sql`${t.approvalThresholdCents} >= 0`),
    check("pool_members_reserved_cents_check", sql`${t.reservedCents} >= 0`),
    check("pool_members_captured_cents_check", sql`${t.capturedCents} >= 0`),
    check("members_never_over_limit", sql`${t.reservedCents} + ${t.capturedCents} <= ${t.limitCents}`),
    check("pool_members_refunded_cents_check", sql`${t.refundedCents} >= 0`),
    check("members_refund_within_captured", sql`${t.refundedCents} <= ${t.capturedCents}`),
  ],
);

/** Kitty's marketplace stores. Seeded by migration from `STORES` in `src/domain/stores.ts`. */
export const stores = pgTable(
  "stores",
  {
    name: text("name").primaryKey(),
    position: integer("position").notNull(),
  },
  (t) => [unique("stores_position_key").on(t.position)],
);

/** The stores a member may buy from, in the order the owner chose them. */
export const memberStores = pgTable(
  "member_stores",
  {
    memberId: text("member_id").notNull(),
    storeName: text("store_name").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "member_stores_pkey", columns: [t.memberId, t.storeName] }),
    foreignKey({ name: "member_stores_member_id_fkey", columns: [t.memberId], foreignColumns: [poolMembers.id] }),
    foreignKey({ name: "member_stores_store_name_fkey", columns: [t.storeName], foreignColumns: [stores.name] }),
  ],
);

/** Every PayPal authorization a pool has held, linked through reauthorizations (architecture 5.5). */
export const authorizations = pgTable(
  "authorizations",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id").notNull(),
    previousAuthorizationId: text("previous_authorization_id"),
    paypalAuthorizationId: text("paypal_authorization_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    honorEndsAt: timestamptz("honor_ends_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    status: text("status").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "authorizations_pool_id_fkey", columns: [t.poolId], foreignColumns: [pools.id] }),
    foreignKey({
      name: "authorizations_previous_authorization_id_fkey",
      columns: [t.previousAuthorizationId],
      foreignColumns: [t.id],
    }),
    unique("authorizations_paypal_authorization_id_key").on(t.paypalAuthorizationId),
    check("authorizations_amount_cents_check", sql`${t.amountCents} >= 0`),
    check("authorizations_status_check", sql`${t.status} IN ('active', 'replaced', 'voided', 'expired')`),
    index("authorizations_by_pool").on(t.poolId, t.createdAt),
  ],
);

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    store: text("store").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),
    priceCents: integer("price_cents").notNull(),
    fetchedAt: timestamptz("fetched_at").notNull().defaultNow(),
  },
  (t) => [
    unique("products_source_external_id_key").on(t.source, t.externalId),
    check("products_source_check", sql`${t.source} IN ('seed', 'channel3')`),
    check("products_price_cents_check", sql`${t.priceCents} > 0`),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id").notNull(),
    memberId: text("member_id").notNull(),
    task: text("task").notNull(),
    status: text("status").notNull(),
    steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
    summary: text("summary"),
    error: text("error"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    heartbeatAt: timestamptz("heartbeat_at").notNull().defaultNow(),
    finishedAt: timestamptz("finished_at"),
  },
  (t) => [
    foreignKey({ name: "agent_runs_pool_id_fkey", columns: [t.poolId], foreignColumns: [pools.id] }),
    foreignKey({ name: "agent_runs_member_id_fkey", columns: [t.memberId], foreignColumns: [poolMembers.id] }),
    check("agent_runs_status_check", sql`${t.status} IN ('running', 'finished', 'failed')`),
    uniqueIndex("agent_runs_one_open_per_member").on(t.memberId).where(sql`status = 'running'`),
  ],
);

export const purchases = pgTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id").notNull(),
    memberId: text("member_id").notNull(),
    productId: text("product_id").notNull(),
    productTitle: text("product_title").notNull(),
    store: text("store").notNull(),
    quantity: integer("quantity").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull(),
    ruleCode: text("rule_code"),
    message: text("message"),
    aiDecision: text("ai_decision"),
    aiReason: text("ai_reason"),
    approvalReason: text("approval_reason"),
    authorizationId: text("authorization_id"),
    captureId: text("capture_id"),
    refundId: text("refund_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    agentRunId: text("agent_run_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    /** Set when a PayPal event contradicts the ledger (S38). */
    needsAttention: boolean("needs_attention").notNull().default(false),
    /** When a waiting approval expires (S41a). */
    approvalExpiresAt: timestamptz("approval_expires_at"),
    /** The owner who approved or denied it. */
    decidedBy: text("decided_by"),
  },
  (t) => [
    foreignKey({ name: "purchases_pool_id_fkey", columns: [t.poolId], foreignColumns: [pools.id] }),
    foreignKey({ name: "purchases_decided_by_fkey", columns: [t.decidedBy], foreignColumns: [users.id] }),
    foreignKey({ name: "purchases_member_id_fkey", columns: [t.memberId], foreignColumns: [poolMembers.id] }),
    foreignKey({ name: "purchases_agent_run_id_fkey", columns: [t.agentRunId], foreignColumns: [agentRuns.id] }),
    unique("purchases_idempotency_key_key").on(t.idempotencyKey),
    check("purchases_quantity_check", sql`${t.quantity} BETWEEN 1 AND 20`),
    check("purchases_amount_cents_check", sql`${t.amountCents} > 0`),
    check(
      "purchases_status_check",
      sql`${t.status} IN ('rejected_by_rules', 'reviewing', 'blocked_by_ai', 'awaiting_approval', 'denied', 'expired', 'capturing', 'captured', 'capture_failed', 'capture_unknown', 'refund_pending', 'refunded')`,
    ),
    index("purchases_by_pool").on(t.poolId, t.createdAt),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    poolId: text("pool_id").notNull(),
    memberId: text("member_id"),
    purchaseId: text("purchase_id"),
    kind: text("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "ledger_entries_pool_id_fkey", columns: [t.poolId], foreignColumns: [pools.id] }),
    foreignKey({ name: "ledger_entries_member_id_fkey", columns: [t.memberId], foreignColumns: [poolMembers.id] }),
    foreignKey({ name: "ledger_entries_purchase_id_fkey", columns: [t.purchaseId], foreignColumns: [purchases.id] }),
    check(
      "ledger_entries_kind_check",
      sql`${t.kind} IN ('authorize', 'reserve', 'release', 'capture', 'refund', 'void')`,
    ),
    check("ledger_entries_amount_cents_check", sql`${t.amountCents} >= 0`),
  ],
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    kind: text("kind").notNull(),
    period: text("period").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ name: "usage_counters_pkey", columns: [t.kind, t.period] })],
);
