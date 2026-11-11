/**
 * The hard rules. Pure functions with no I/O, run in code before any AI call.
 * AI output can only make an outcome stricter (see `finalOutcome`).
 */
import { formatUsd } from "./money";

export type PoolFunds = {
  status: string;
  authorizedCents: number;
  reservedCents: number;
  capturedCents: number;
  releasedCents: number;
  holdExpiresAt: Date | null;
};

export type MemberFunds = {
  active: boolean;
  limitCents: number;
  reservedCents: number;
  capturedCents: number;
  approvalThresholdCents: number;
  allowedStores: string[];
};

export type RuleCode =
  | "invalid_amount"
  | "pool_not_active"
  | "hold_expired"
  | "member_inactive"
  | "store_not_allowed"
  | "over_member_limit"
  | "over_pool_balance";

export type RuleCheck =
  | { ok: true; needsApproval: boolean }
  | { ok: false; code: RuleCode; message: string };

export function poolAvailable(pool: PoolFunds): number {
  return pool.authorizedCents - pool.reservedCents - pool.capturedCents - pool.releasedCents;
}

export function memberRemaining(member: MemberFunds): number {
  return member.limitCents - member.reservedCents - member.capturedCents;
}

export function checkHardRules(input: {
  pool: PoolFunds;
  member: MemberFunds;
  store: string;
  amountCents: number;
  now: Date;
}): RuleCheck {
  const { pool, member, store, amountCents, now } = input;

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return fail("invalid_amount", "The amount isn't valid.");
  }
  if (pool.status !== "active") {
    return fail("pool_not_active", "This pool isn't open for spending.");
  }
  if (pool.holdExpiresAt && pool.holdExpiresAt.getTime() <= now.getTime()) {
    return fail("hold_expired", "The PayPal hold for this pool has expired.");
  }
  if (!member.active) {
    return fail("member_inactive", "This member can't spend from the pool.");
  }
  if (!member.allowedStores.includes(store)) {
    return fail("store_not_allowed", `${store} isn't on this member's allowed stores.`);
  }
  const remaining = memberRemaining(member);
  if (amountCents > remaining) {
    return fail(
      "over_member_limit",
      `${formatUsd(amountCents)} is more than the ${formatUsd(Math.max(remaining, 0))} left on this member's limit.`,
    );
  }
  const available = poolAvailable(pool);
  if (amountCents > available) {
    return fail(
      "over_pool_balance",
      `${formatUsd(amountCents)} is more than the ${formatUsd(Math.max(available, 0))} left in the pool.`,
    );
  }
  // A $0 threshold means every purchase needs approval.
  return { ok: true, needsApproval: amountCents > member.approvalThresholdCents };
}

export type AiDecision = "allow" | "flag" | "block" | "unavailable";
export type Outcome = "capture" | "needs_approval" | "blocked";

/**
 * Strictest outcome wins. AI `allow` changes nothing, `flag` and any AI
 * failure send the purchase to the owner, and `block` stops it.
 */
export function finalOutcome(ruleNeedsApproval: boolean, ai: AiDecision): Outcome {
  if (ai === "block") return "blocked";
  if (ai === "flag" || ai === "unavailable" || ruleNeedsApproval) return "needs_approval";
  return "capture";
}

function fail(code: RuleCode, message: string): RuleCheck {
  return { ok: false, code, message };
}
