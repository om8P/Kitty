/**
 * Pure helpers for the S05 capture spike (scripts/spike/01-capture.ts).
 * Kept apart from the script so the redaction and replay logic can be tested.
 */
import type { PayPalCapture, PayPalResult } from "../../src/adapters/payments/paypal-client";

export const ORDER_AMOUNT = "150.00";
export const MAX_CAPTURES = 50;

const FIRST_AMOUNTS = ["20.00", "15.00", "10.00"];
const LATER_AMOUNT = "2.00";

/** Amount for capture `n` (1-based): three larger partial captures, then small ones. */
export function captureAmount(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > MAX_CAPTURES) throw new Error(`Capture number out of range: ${n}`);
  return FIRST_AMOUNTS[n - 1] ?? LATER_AMOUNT;
}

/** Total of captures 1..count, in cents. Must stay under the $150 authorization. */
export function plannedTotalCents(count: number): number {
  let total = 0;
  for (let n = 1; n <= count; n++) total += Math.round(Number(captureAmount(n)) * 100);
  return total;
}

export function captureRequestId(authorizationId: string, n: number): string {
  return `s05-capture-${authorizationId}-${n}`;
}

export function captureInvoiceId(runId: string, n: number): string {
  return `s05-${runId}-cap-${n}`;
}

/** What gets saved about one capture call. Only IDs, codes and amounts. */
export type CallSummary = {
  outcome: PayPalResult<unknown>["outcome"];
  captureId?: string;
  status?: string;
  amount?: string;
  code?: string;
  message?: string;
  reason?: string;
  httpStatus?: number;
  debugId?: string;
};

export function summarizeCapture(result: PayPalResult<PayPalCapture>): CallSummary {
  if (result.outcome === "succeeded") {
    return {
      outcome: result.outcome,
      captureId: result.data.id,
      status: result.data.status,
      amount: result.data.amount?.value,
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

export type ReplayVerdict =
  /** PayPal returned the original capture: replay is safe. */
  | "returned_original"
  /** PayPal made a second capture: replay double-charges. */
  | "new_capture"
  /** PayPal answered with an error or unclear result instead of the original. */
  | "not_returned";

export function compareReplay(originalCaptureId: string, replay: CallSummary): ReplayVerdict {
  if (replay.outcome !== "succeeded" || !replay.captureId) return "not_returned";
  return replay.captureId === originalCaptureId ? "returned_original" : "new_capture";
}

/** One logged request and response. Secrets are removed before it is built. */
export type LogEntry = {
  at: string;
  method: string;
  path: string;
  requestId?: string;
  requestBody?: string;
  status?: number;
  debugId?: string;
  responseBody?: string;
  error?: string;
  ms: number;
};

const TOKEN_PATH = "/v1/oauth2/token";
export const REDACTED = "[redacted]";

/**
 * Wraps `fetch` so every PayPal exchange is logged without credentials: the
 * Authorization header is never read into the log, and the OAuth token call
 * has its bodies replaced.
 */
export function createLoggingFetch(
  baseFetch: typeof fetch,
  write: (entry: LogEntry) => void,
  now: () => Date = () => new Date(),
): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const isToken = url.pathname === TOKEN_PATH;
    const headers = new Headers(init?.headers);
    const startedAt = now();
    const base = {
      at: startedAt.toISOString(),
      method: init?.method ?? "GET",
      path: url.pathname + url.search,
      requestId: headers.get("paypal-request-id") ?? undefined,
      requestBody: isToken ? REDACTED : typeof init?.body === "string" ? init.body : undefined,
    };
    try {
      const response = await baseFetch(input, init);
      const text = await response.clone().text();
      write({
        ...base,
        status: response.status,
        debugId: response.headers.get("paypal-debug-id") ?? undefined,
        responseBody: isToken ? REDACTED : text,
        ms: now().getTime() - startedAt.getTime(),
      });
      return response;
    } catch (error) {
      write({
        ...base,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        ms: now().getTime() - startedAt.getTime(),
      });
      throw error;
    }
  };
}
