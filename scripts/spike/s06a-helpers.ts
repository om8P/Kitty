/**
 * Pure helpers for the S06a refund and void spike (scripts/spike/02-refund-void.ts).
 * Kept apart from the script so the verdict logic can be tested.
 */
import type { PayPalRefund, PayPalResult } from "../../src/adapters/payments/paypal-client";
import type { CallSummary } from "./s05-helpers";

export const ORDER_AMOUNT = "100.00";

/** Captures #1 to #3: $90 of the $100 authorization. Capture #3 is the one refunded. */
export const CAPTURE_AMOUNTS = ["20.00", "30.00", "40.00"] as const;
export const REFUNDED_CAPTURE = 3;
/** Capture #1 is refunded after the void, to test refunds on a closed pool. */
export const REFUND_AFTER_VOID_CAPTURE = 1;

/**
 * Probes are sized so PayPal's possible over-capture allowance (reportedly up
 * to 115%, [verify]) can't fake a result: $90 + $30 = $120 is above $115, but
 * $50 + $30 = $80 fits if the refund gave capacity back.
 */
export const PROBES = {
  control: "30.00",
  "after-refund": "30.00",
  small: "5.00",
} as const;
export type ProbeLabel = keyof typeof PROBES;

export function isProbeLabel(value: string | undefined): value is ProbeLabel {
  return value !== undefined && Object.hasOwn(PROBES, value);
}

export function captureRequestId(authorizationId: string, n: number): string {
  return `s06a-capture-${authorizationId}-${n}`;
}

export function probeRequestId(authorizationId: string, label: ProbeLabel): string {
  return `s06a-probe-${authorizationId}-${label}`;
}

export function refundRequestId(captureId: string, variant: "" | "again" = ""): string {
  return variant ? `s06a-refund-${captureId}-${variant}` : `s06a-refund-${captureId}`;
}

export function voidRequestId(authorizationId: string): string {
  return `s06a-void-${authorizationId}`;
}

export function captureInvoiceId(runId: string, label: string): string {
  return `s06a-${runId}-${label}`;
}

/** What gets saved about one refund call. Only IDs, codes and amounts. */
export type RefundSummary = Omit<CallSummary, "captureId"> & { refundId?: string };

export function summarizeRefund(result: PayPalResult<PayPalRefund>): RefundSummary {
  if (result.outcome === "succeeded") {
    return {
      outcome: result.outcome,
      refundId: result.data.id,
      status: result.data.status,
      amount: result.data.amount?.value,
      httpStatus: result.httpStatus,
      debugId: result.debugId,
    };
  }
  if (result.outcome === "unknown") {
    return { outcome: result.outcome, reason: result.reason, httpStatus: result.httpStatus, debugId: result.debugId };
  }
  return { outcome: result.outcome, code: result.code, message: result.message, httpStatus: result.httpStatus, debugId: result.debugId };
}

export type RefundReplayVerdict = "returned_original" | "new_refund" | "not_returned";

export function compareRefundReplay(originalRefundId: string, replay: RefundSummary): RefundReplayVerdict {
  if (replay.outcome !== "succeeded" || !replay.refundId) return "not_returned";
  return replay.refundId === originalRefundId ? "returned_original" : "new_refund";
}

export type CapacityVerdict =
  /** The control was refused and the same capture fit after the refund. */
  | "restored"
  /** The capture was refused both before and after the refund. */
  | "not_restored"
  /** The control capture succeeded, or an outcome was unclear. */
  | "inconclusive";

export function capacityVerdict(control: CallSummary, afterRefund: CallSummary): CapacityVerdict {
  if (control.outcome !== "failed") return "inconclusive";
  if (afterRefund.outcome === "succeeded") return "restored";
  if (afterRefund.outcome === "failed") return "not_restored";
  return "inconclusive";
}

/** PayPal's error name and issue codes, read from a raw response body. */
export type Issue = { name?: string; issues: string[]; description?: string };

export function extractIssue(responseBody: string | undefined): Issue | undefined {
  if (!responseBody) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const body = parsed as { name?: unknown; details?: unknown };
  const name = typeof body.name === "string" ? body.name : undefined;
  const details = Array.isArray(body.details) ? body.details : [];
  const issues: string[] = [];
  let description: string | undefined;
  for (const detail of details) {
    if (typeof detail !== "object" || detail === null) continue;
    const { issue, description: text } = detail as { issue?: unknown; description?: unknown };
    if (typeof issue === "string") issues.push(issue);
    if (description === undefined && typeof text === "string") description = text;
  }
  if (!name && issues.length === 0) return undefined;
  return { name, issues, description };
}
