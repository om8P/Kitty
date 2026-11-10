/**
 * Pure helpers for the S06b reauthorize spike (scripts/spike/03-reauthorize.ts).
 * Kept apart from the script so the amount, timing and replay logic can be tested.
 */
import type { PayPalAuthorization, PayPalResult } from "../../src/adapters/payments/paypal-client";
import type { CallSummary } from "./s05-helpers";

export const HONOR_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Attempt 1 uses the fixed ID the product would use (arch 7.2). Later attempts
 * get a suffix, in case PayPal keeps a refused answer under the first ID.
 */
export function reauthRequestId(authorizationId: string, attempt = 1): string {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error(`Bad attempt number: ${attempt}`);
  return attempt === 1 ? `s06b-reauth-${authorizationId}` : `s06b-reauth-${authorizationId}-a${attempt}`;
}

export function captureRequestId(authorizationId: string, n: number): string {
  return `s06b-capture-${authorizationId}-${n}`;
}

export function voidRequestId(authorizationId: string): string {
  return `s06b-void-${authorizationId}`;
}

export function toCents(value: string | undefined): number {
  return value === undefined ? 0 : Math.round(Number(value) * 100);
}

export function centsToValue(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Bad cent amount: ${cents}`);
  return (cents / 100).toFixed(2);
}

/** Captures that hold money: completed or still pending. */
const HELD_CAPTURE_STATUSES = new Set(["COMPLETED", "PENDING"]);

/** `authorized - captured`, the most a reauthorization may ask for (arch 5.5). Never below zero. */
export function remainingCents(
  authorizedValue: string | undefined,
  captures: { status: string; amount?: { value: string } }[],
): number {
  const captured = captures
    .filter((capture) => HELD_CAPTURE_STATUSES.has(capture.status))
    .reduce((sum, capture) => sum + toCents(capture.amount?.value), 0);
  return Math.max(0, toCents(authorizedValue) - captured);
}

/** End of the 3-day honor period. PayPal documents reauthorization as allowed only after it. */
export function honorEndsAt(createTime: string): Date {
  const created = Date.parse(createTime);
  if (Number.isNaN(created)) throw new Error(`Unreadable create time: ${createTime}`);
  return new Date(created + HONOR_PERIOD_MS);
}

/** Hours from `from` to `to`, rounded to one decimal. */
export function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10;
}

export type AuthorizationSummary = CallSummary & { authorizationId?: string; expiresAt?: string };

export function summarizeAuthorization(result: PayPalResult<PayPalAuthorization>): AuthorizationSummary {
  if (result.outcome === "succeeded") {
    return {
      outcome: result.outcome,
      authorizationId: result.data.id,
      status: result.data.status,
      amount: result.data.amount?.value,
      expiresAt: result.data.expiration_time,
      httpStatus: result.httpStatus,
      debugId: result.debugId,
    };
  }
  if (result.outcome === "unknown") {
    return { outcome: result.outcome, reason: result.reason, httpStatus: result.httpStatus, debugId: result.debugId };
  }
  return {
    outcome: result.outcome,
    code: result.code,
    message: result.message,
    httpStatus: result.httpStatus,
    debugId: result.debugId,
  };
}

export type ReauthReplayVerdict =
  /** PayPal returned the first reauthorization: replay is safe. */
  | "returned_original"
  /** PayPal made a second reauthorization. */
  | "new_authorization"
  /** PayPal answered with an error or unclear result instead. */
  | "not_returned";

export function compareReauthReplay(originalId: string, replay: AuthorizationSummary): ReauthReplayVerdict {
  if (replay.outcome !== "succeeded" || !replay.authorizationId) return "not_returned";
  return replay.authorizationId === originalId ? "returned_original" : "new_authorization";
}

/** The parts of a PayPal error body worth recording. Never the whole body. */
export type PayPalIssue = { name?: string; issue?: string; description?: string };

export function extractIssue(responseBody: string | undefined): PayPalIssue | undefined {
  if (!responseBody) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const body = parsed as { name?: unknown; details?: unknown };
  const detail = Array.isArray(body.details)
    ? (body.details[0] as { issue?: unknown; description?: unknown } | undefined)
    : undefined;
  const issue: PayPalIssue = {
    name: typeof body.name === "string" ? body.name : undefined,
    issue: typeof detail?.issue === "string" ? detail.issue : undefined,
    description: typeof detail?.description === "string" ? detail.description : undefined,
  };
  return issue.name || issue.issue ? issue : undefined;
}
