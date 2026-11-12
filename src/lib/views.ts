/** The JSON shapes the screens read. Shared by the routes and the client components. */
import type { PoolState } from "@/domain/pools";
import type { AgentStep, MemberRow, PoolRow, PoolStatus, PurchaseRow, PurchaseStatus } from "@/domain/types";

export type PoolView = {
  id: string;
  goal: string;
  status: PoolStatus;
  rail: string;
  termDays: number;
  endsAt: string;
  requestedCents: number;
  authorizedCents: number;
  reservedCents: number;
  capturedCents: number;
  refundedCents: number;
  releasedCents: number;
  availableCents: number;
  holdExpiresAt: string | null;
  note: string | null;
  /** Set only while the pool waits for the owner's PayPal approval, so the page can check again. */
  pendingOrderId: string | null;
  createdAt: string;
  closedAt: string | null;
};

export type MemberView = {
  id: string;
  kind: "person" | "agent";
  userId: string | null;
  label: string;
  /** False once the owner removes them. They can't spend, and what they spent stays. */
  active: boolean;
  limitCents: number;
  usedCents: number;
  remainingCents: number;
  approvalThresholdCents: number;
  allowedStores: string[];
};

export type PurchaseView = {
  id: string;
  memberId: string;
  memberLabel: string;
  memberKind: "person" | "agent";
  title: string;
  store: string;
  quantity: number;
  amountCents: number;
  status: PurchaseStatus;
  ruleCode: string | null;
  message: string | null;
  aiDecision: "allow" | "flag" | "block" | "unavailable" | null;
  aiReason: string | null;
  approvalReason: string | null;
  createdAt: string;
};

export type RunView = {
  id: string;
  task: string;
  status: "running" | "finished" | "failed";
  steps: AgentStep[];
  summary: string | null;
  error: string | null;
  createdAt: string;
};

export type Capabilities = {
  payments: "paypal" | "unconfigured";
  ai: boolean;
  catalog: "channel3" | "seed";
};

export type PoolStateView = {
  pool: PoolView;
  members: MemberView[];
  purchases: PurchaseView[];
  runs: RunView[];
  capabilities: Capabilities;
};

export type ProductView = {
  id: string;
  source: "seed" | "channel3";
  store: string;
  title: string;
  description: string;
  imageUrl: string | null;
  priceCents: number;
};

export type ShopView = {
  pool: PoolView | null;
  member: MemberView | null;
  purchases: PurchaseView[];
  capabilities: Capabilities;
};

export function toPoolView(pool: PoolRow): PoolView {
  const available = pool.authorized_cents - pool.reserved_cents - pool.captured_cents - pool.released_cents;
  return {
    id: pool.id,
    goal: pool.goal,
    status: pool.status,
    rail: pool.rail,
    termDays: pool.term_days,
    endsAt: iso(pool.ends_at),
    requestedCents: pool.requested_cents,
    authorizedCents: pool.authorized_cents,
    reservedCents: pool.reserved_cents,
    capturedCents: pool.captured_cents,
    refundedCents: pool.refunded_cents,
    releasedCents: pool.released_cents,
    availableCents: pool.status === "active" ? Math.max(available, 0) : 0,
    holdExpiresAt: pool.hold_expires_at ? iso(pool.hold_expires_at) : null,
    note: pool.note,
    pendingOrderId: pool.status === "awaiting_payer" ? pool.paypal_order_id : null,
    createdAt: iso(pool.created_at),
    closedAt: pool.closed_at ? iso(pool.closed_at) : null,
  };
}

export function toMemberView(member: MemberRow): MemberView {
  const used = member.reserved_cents + member.captured_cents;
  return {
    id: member.id,
    kind: member.kind,
    userId: member.user_id,
    label: member.label,
    active: member.active,
    limitCents: member.limit_cents,
    usedCents: used,
    remainingCents: Math.max(member.limit_cents - used, 0),
    approvalThresholdCents: member.approval_threshold_cents,
    allowedStores: member.allowed_stores,
  };
}

export function toPurchaseView(purchase: PurchaseRow, members: MemberRow[]): PurchaseView {
  const member = members.find((candidate) => candidate.id === purchase.member_id);
  return {
    id: purchase.id,
    memberId: purchase.member_id,
    memberLabel: member?.label ?? "Member",
    memberKind: member?.kind ?? "person",
    title: purchase.product_title,
    store: purchase.store,
    quantity: purchase.quantity,
    amountCents: purchase.amount_cents,
    status: purchase.status,
    ruleCode: purchase.rule_code,
    message: purchase.message,
    aiDecision: purchase.ai_decision,
    aiReason: purchase.ai_reason,
    approvalReason: purchase.approval_reason,
    createdAt: iso(purchase.created_at),
  };
}

export function toPoolStateView(state: PoolState, capabilities: Capabilities): PoolStateView {
  return {
    pool: toPoolView(state.pool),
    members: state.members.map(toMemberView),
    purchases: state.purchases.map((purchase) => toPurchaseView(purchase, state.members)),
    runs: state.runs.map((run) => ({
      id: run.id,
      task: run.task,
      status: run.status,
      steps: Array.isArray(run.steps) ? run.steps : [],
      summary: run.summary,
      error: run.error,
      createdAt: iso(run.created_at),
    })),
    capabilities,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
