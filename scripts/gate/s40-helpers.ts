/**
 * Pure checks for the S40 gate script: the pool-integrity comparison between
 * Kitty's ledger and PayPal's record of the order's captures, and the verdict
 * for each scenario. Kept free of I/O so they can be unit tested.
 */

export type PayPalCaptureLine = { status: string; amountValue?: string; invoiceId?: string };

export type IntegrityResult = {
  paypalCapturedCents: number;
  paypalCaptureCount: number;
  kittyCapturedCents: number;
  /** Captures whose invoice_id doesn't name one of the pool's captured purchases. */
  unmatched: number;
  match: boolean;
};

/** Statuses of a capture that moved money, whether or not it was later refunded. */
const MOVED_MONEY = new Set(["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"]);

export function toCents(value: string | undefined): number {
  return value === undefined ? 0 : Math.round(Number(value) * 100);
}

/**
 * Compares the pool's captured total with PayPal's. Kitty's `captured_cents`
 * includes refunded captures (a refund goes back to the payer, arch 7.3), so
 * it is compared with every capture that moved money.
 */
export function compareIntegrity(
  kittyCapturedCents: number,
  capturedPurchaseIds: string[],
  captures: PayPalCaptureLine[],
): IntegrityResult {
  const moved = captures.filter((capture) => MOVED_MONEY.has(capture.status));
  const paypalCapturedCents = moved.reduce((sum, capture) => sum + toCents(capture.amountValue), 0);
  const ids = new Set(capturedPurchaseIds.map((id) => `kitty-${id}`));
  const unmatched = moved.filter((capture) => !capture.invoiceId || !ids.has(capture.invoiceId)).length;
  return {
    paypalCapturedCents,
    paypalCaptureCount: moved.length,
    kittyCapturedCents,
    unmatched,
    match: paypalCapturedCents === kittyCapturedCents && unmatched === 0 && moved.length === ids.size,
  };
}

export type RuleBreakerResult = { status: string; ruleCode: string | null; aiDecision: string | null };

/** A rule breaker passes when the rules stopped it with the expected code and the AI never saw it. */
export function ruleBreakerPassed(result: RuleBreakerResult, expectedCode: string): boolean {
  return result.status === "rejected_by_rules" && result.ruleCode === expectedCode && result.aiDecision === null;
}

/** An off-goal purchase passes when the AI flagged it (sent to the owner) or blocked it. */
export function offGoalPassed(status: string, aiDecision: string | null): boolean {
  return (
    (status === "blocked_by_ai" && aiDecision === "block") || (status === "awaiting_approval" && aiDecision === "flag")
  );
}
