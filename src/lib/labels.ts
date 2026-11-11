/** Words for statuses, shared by every screen so one thing always has one name. */
import type { PurchaseStatus } from "@/domain/types";
import type { PurchaseView } from "./views";

export type Tone = "ok" | "warn" | "stop" | "neutral";

export const STATUS_LABELS: Record<PurchaseStatus, { label: string; tone: Tone }> = {
  rejected_by_rules: { label: "Stopped by a rule", tone: "stop" },
  reviewing: { label: "Checking", tone: "neutral" },
  blocked_by_ai: { label: "Blocked by AI check", tone: "stop" },
  awaiting_approval: { label: "Needs approval", tone: "warn" },
  denied: { label: "Denied", tone: "stop" },
  expired: { label: "Expired", tone: "neutral" },
  capturing: { label: "Paying", tone: "neutral" },
  captured: { label: "Paid", tone: "ok" },
  capture_failed: { label: "Payment declined", tone: "stop" },
  capture_unknown: { label: "Confirming payment", tone: "warn" },
  refund_pending: { label: "Refunding", tone: "warn" },
  refunded: { label: "Refunded", tone: "neutral" },
};

const RULE_LABELS: Record<string, string> = {
  invalid_amount: "Invalid amount",
  pool_not_active: "Pool closed",
  hold_expired: "Hold expired",
  member_inactive: "Member inactive",
  store_not_allowed: "Store not allowed",
  over_member_limit: "Over member limit",
  over_pool_balance: "Over pool balance",
};

export function ruleLabel(purchase: Pick<PurchaseView, "ruleCode">): string {
  if (!purchase.ruleCode) return "Passed";
  return RULE_LABELS[purchase.ruleCode] ?? "Stopped";
}

const AI_LABELS: Record<string, string> = {
  allow: "Fits the goal",
  flag: "Flagged",
  block: "Blocked",
  unavailable: "Unavailable",
};

export function aiLabel(purchase: Pick<PurchaseView, "aiDecision" | "status">): string {
  if (purchase.aiDecision) return AI_LABELS[purchase.aiDecision];
  if (purchase.status === "reviewing") return "Checking";
  return "Not run";
}

/** One plain sentence saying why a purchase is where it is. */
export function purchaseExplanation(purchase: PurchaseView): string {
  if (purchase.status === "awaiting_approval") {
    const why = purchase.approvalReason ?? "Needs a decision";
    return purchase.aiReason && purchase.aiDecision !== "allow" ? `${why}: ${purchase.aiReason}` : `${why}.`;
  }
  if (purchase.status === "blocked_by_ai") return purchase.aiReason ?? "It doesn't fit the pool's goal.";
  return purchase.message ?? "";
}

const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

export function formatDay(iso: string): string {
  return day.format(new Date(iso));
}
