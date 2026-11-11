import type { MemberFunds, PoolFunds } from "./rules";

/** Rows as Postgres returns them. Money columns are integer cents. */

export type PoolStatus = "draft" | "awaiting_payer" | "active" | "closing" | "closed" | "abandoned";

export type PoolRow = {
  id: string;
  household_id: string;
  owner_user_id: string;
  goal: string;
  status: PoolStatus;
  term_days: number;
  ends_at: Date;
  rail: string;
  requested_cents: number;
  authorized_cents: number;
  reserved_cents: number;
  captured_cents: number;
  refunded_cents: number;
  released_cents: number;
  paypal_order_id: string | null;
  authorization_id: string | null;
  hold_expires_at: Date | null;
  note: string | null;
  created_at: Date;
  closed_at: Date | null;
};

export type MemberRow = {
  id: string;
  pool_id: string;
  kind: "person" | "agent";
  user_id: string | null;
  label: string;
  active: boolean;
  limit_cents: number;
  approval_threshold_cents: number;
  allowed_stores: string[];
  reserved_cents: number;
  captured_cents: number;
  position: number;
};

export type PurchaseStatus =
  | "rejected_by_rules"
  | "reviewing"
  | "blocked_by_ai"
  | "awaiting_approval"
  | "denied"
  | "expired"
  | "capturing"
  | "captured"
  | "capture_failed"
  | "capture_unknown"
  | "refund_pending"
  | "refunded";

export type PurchaseRow = {
  id: string;
  pool_id: string;
  member_id: string;
  product_id: string;
  product_title: string;
  store: string;
  quantity: number;
  amount_cents: number;
  status: PurchaseStatus;
  rule_code: string | null;
  message: string | null;
  ai_decision: "allow" | "flag" | "block" | "unavailable" | null;
  ai_reason: string | null;
  approval_reason: string | null;
  authorization_id: string | null;
  capture_id: string | null;
  refund_id: string | null;
  idempotency_key: string;
  agent_run_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ProductRow = {
  id: string;
  source: "seed" | "channel3";
  external_id: string;
  store: string;
  title: string;
  description: string;
  image_url: string | null;
  price_cents: number;
  fetched_at: Date;
};

export type AgentStep =
  | { type: "search"; query: string; found: number }
  | { type: "purchase"; title: string; amountCents: number; status: string; message: string }
  | { type: "note"; text: string };

export type AgentRunRow = {
  id: string;
  pool_id: string;
  member_id: string;
  task: string;
  status: "running" | "finished" | "failed";
  steps: AgentStep[];
  summary: string | null;
  error: string | null;
  created_at: Date;
  heartbeat_at: Date;
  finished_at: Date | null;
};

export type UserRow = { id: string; household_id: string; name: string; role: "owner" | "member" };

export function poolFunds(pool: PoolRow): PoolFunds {
  return {
    status: pool.status,
    authorizedCents: pool.authorized_cents,
    reservedCents: pool.reserved_cents,
    capturedCents: pool.captured_cents,
    releasedCents: pool.released_cents,
    holdExpiresAt: pool.hold_expires_at,
  };
}

export function memberFunds(member: MemberRow): MemberFunds {
  return {
    active: member.active,
    limitCents: member.limit_cents,
    reservedCents: member.reserved_cents,
    capturedCents: member.captured_cents,
    approvalThresholdCents: member.approval_threshold_cents,
    allowedStores: member.allowed_stores,
  };
}

export type DomainErrorCode = "not_found" | "forbidden" | "conflict" | "invalid";

/** An expected failure with a message that is safe to show the user. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}
