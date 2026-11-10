import { z } from "zod";

/**
 * Typed PayPal sandbox REST client (plan step S04).
 *
 * Every call returns a `PayPalResult` and never throws. The one rule that
 * matters: an unclear outcome is `unknown`, never `failed`, because the ledger
 * releases reserved funds only on a definite failure (architecture 7.2).
 *
 * Sandbox only. The base URL is a constant and the config has no URL field.
 */
export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

const DEFAULT_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * 422 issues meaning the operation isn't enabled or allowed for this account
 * or authorization. [verify] From PayPal's Orders v2 error reference. S05 to
 * S07 extend this list from observed errors.
 */
export const UNSUPPORTED_ISSUES: ReadonlySet<string> = new Set([
  "AUTH_CAPTURE_NOT_ENABLED",
  "UNSUPPORTED_INTENT",
  "UNSUPPORTED_INTENT_FOR_PAYMENT_SOURCE",
  "ACTION_DOES_NOT_MATCH_INTENT",
  "PAYMENT_TYPE_NOT_SUPPORTED_FOR_INTENT",
  // Observed in S06b: reauthorizing inside the 3-day honor period. Nothing changes.
  "REAUTHORIZATION_TOO_SOON",
]);

/**
 * 422 issues that definitely mean nothing happened. [verify] Kept short on
 * purpose: any 422 issue not listed here is `unknown`.
 */
export const DEFINITE_FAILURE_ISSUES: ReadonlySet<string> = new Set([
  "INSTRUMENT_DECLINED",
  "TRANSACTION_REFUSED",
]);

/**
 * Issues that can mean an earlier request with the same ID already worked.
 * They are `unknown` whatever the HTTP status, so a replay never releases
 * funds. [verify] Some names come from PayPal's error reference and some from
 * related endpoints. Listing too many is safe here.
 */
export const ALREADY_DONE_ISSUES: ReadonlySet<string> = new Set([
  "DUPLICATE_INVOICE_ID",
  "PREVIOUS_REQUEST_IN_PROGRESS",
  "ORDER_ALREADY_AUTHORIZED",
  "ORDER_ALREADY_CAPTURED",
  "ORDER_COMPLETED_OR_VOIDED",
  "PREVIOUS_TRANSACTION_REFERENCE_VOIDED",
  "PREVIOUSLY_CAPTURED",
  "AUTHORIZATION_ALREADY_CAPTURED",
  "PREVIOUSLY_VOIDED",
  "AUTHORIZATION_VOIDED",
  "CAPTURE_FULLY_REFUNDED",
]);

export type UnknownReason =
  | "timeout"
  | "network"
  | "auth_unavailable"
  | "rate_limited"
  | "conflict"
  | "server_error"
  | "unexpected_status"
  | "unreadable_response"
  | "unrecognized_error"
  | "unclear_status"
  | "client_error";

export type PayPalResult<T> =
  | { outcome: "succeeded"; data: T; httpStatus: number; debugId?: string }
  | {
      outcome: "failed" | "unsupported";
      code: string;
      message: string;
      httpStatus?: number;
      debugId?: string;
    }
  | { outcome: "unknown"; reason: UnknownReason; httpStatus?: number; debugId?: string };

export type Money = { currencyCode: "USD"; value: string };

export type PayPalClientConfig = {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

// Response schemas are loose, so new PayPal fields never break parsing.

const linkSchema = z.looseObject({ href: z.string(), rel: z.string() });
const amountSchema = z.looseObject({ currency_code: z.string(), value: z.string() });

const authorizationSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  amount: amountSchema.optional(),
  expiration_time: z.string().optional(),
  links: z.array(linkSchema).optional(),
});

const captureSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  amount: amountSchema.optional(),
  invoice_id: z.string().optional(),
  final_capture: z.boolean().optional(),
  links: z.array(linkSchema).optional(),
});

const refundSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  amount: amountSchema.optional(),
});

const orderSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  links: z.array(linkSchema).optional(),
  purchase_units: z
    .array(
      z.looseObject({
        payments: z
          .looseObject({
            authorizations: z.array(authorizationSchema).optional(),
            captures: z.array(captureSchema).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const tokenSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const verificationSchema = z.looseObject({ verification_status: z.string() });

const errorSchema = z.looseObject({
  name: z.string().min(1),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  details: z.array(z.looseObject({ issue: z.string().optional() })).optional(),
});

export type PayPalOrder = z.infer<typeof orderSchema>;
export type PayPalAuthorization = z.infer<typeof authorizationSchema>;
export type PayPalCapture = z.infer<typeof captureSchema>;
export type PayPalRefund = z.infer<typeof refundSchema>;

export type CreatedOrder = { order: PayPalOrder; approvalUrl: string };
export type AuthorizedOrder = { order: PayPalOrder; authorization: PayPalAuthorization };
export type VoidedAuthorization = { authorization?: PayPalAuthorization };

/** Read from the incoming webhook request, for example `request.headers`. */
export type HeaderSource = { get(name: string): string | null };

type Reply =
  | { kind: "reply"; status: number; text: string; debugId?: string }
  | { kind: "unknown"; reason: UnknownReason; httpStatus?: number };

/** What a 2xx body means for the call, once it has been parsed. */
type Interpretation<T> =
  | { outcome: "succeeded"; data: T }
  | { outcome: "failed"; code: string; message: string }
  | { outcome: "unknown" };

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;

export function createPayPalClient(config: PayPalClientConfig) {
  const fetchImpl = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = config.now ?? Date.now;

  let cachedToken: { token: string; refreshAt: number } | undefined;
  let tokenInFlight: Promise<string | undefined> | undefined;

  async function exchange(path: string, init: RequestInit): Promise<Reply> {
    try {
      const response = await fetchImpl(`${PAYPAL_SANDBOX_BASE_URL}${path}`, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      // The timeout signal also covers reading the body.
      const text = await response.text();
      return {
        kind: "reply",
        status: response.status,
        text,
        debugId: response.headers.get("paypal-debug-id") ?? undefined,
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const timedOut = name === "TimeoutError" || name === "AbortError";
      return { kind: "unknown", reason: timedOut ? "timeout" : "network" };
    }
  }

  async function fetchToken(): Promise<string | undefined> {
    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const reply = await exchange("/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (reply.kind !== "reply" || reply.status !== 200) return undefined;
    const json = parseJson(reply.text);
    const parsed = json.ok ? tokenSchema.safeParse(json.value) : undefined;
    if (!parsed?.success) return undefined;
    cachedToken = {
      token: parsed.data.access_token,
      refreshAt: now() + parsed.data.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS,
    };
    return cachedToken.token;
  }

  async function getToken(): Promise<string | undefined> {
    if (cachedToken && now() < cachedToken.refreshAt) return cachedToken.token;
    tokenInFlight ??= fetchToken().finally(() => {
      tokenInFlight = undefined;
    });
    return tokenInFlight;
  }

  /** Sends an authenticated call. A 401 refreshes the token and retries once with the same request ID. */
  async function call(method: "GET" | "POST", path: string, body?: string, requestId?: string): Promise<Reply> {
    let reply: Reply = { kind: "unknown", reason: "auth_unavailable" };
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getToken();
      if (!token) return { kind: "unknown", reason: "auth_unavailable" };

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (requestId !== undefined) {
        headers["PayPal-Request-Id"] = requestId;
        headers.Prefer = "return=representation";
      }

      reply = await exchange(path, { method, headers, body });
      if (reply.kind === "reply" && reply.status === 401 && attempt === 0) {
        if (cachedToken?.token === token) cachedToken = undefined;
        continue;
      }
      return reply;
    }
    return reply;
  }

  async function run<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType,
    interpret: (data: never) => Interpretation<T>,
    options: { body?: string; requestId?: string } = {},
  ): Promise<PayPalResult<T>> {
    try {
      const reply = await call(method, path, options.body, options.requestId);
      return classify(reply, schema, interpret);
    } catch {
      return { outcome: "unknown", reason: "client_error" };
    }
  }

  // Reads succeed whenever the response parses. The status is just data.
  const asIs = <T>(data: T): Interpretation<T> => ({ outcome: "succeeded", data });

  return {
    async createOrder(input: {
      requestId: string;
      amount: Money;
      returnUrl: string;
      cancelUrl: string;
      invoiceId?: string;
      customId?: string;
    }): Promise<PayPalResult<CreatedOrder>> {
      const invalid = checkRequestId(input.requestId) ?? checkAmount(input.amount);
      if (invalid) return invalid;
      const body = JSON.stringify({
        intent: "AUTHORIZE",
        purchase_units: [
          {
            amount: toPayPalAmount(input.amount),
            invoice_id: input.invoiceId,
            custom_id: input.customId,
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
              shipping_preference: "NO_SHIPPING",
            },
          },
        },
      });
      return run<CreatedOrder>("POST", "/v2/checkout/orders", orderSchema, (order: PayPalOrder) => {
        const approvalUrl = order.links?.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href;
        if ((order.status === "CREATED" || order.status === "PAYER_ACTION_REQUIRED") && approvalUrl) {
          return { outcome: "succeeded", data: { order, approvalUrl } };
        }
        return { outcome: "unknown" };
      }, { body, requestId: input.requestId });
    },

    getOrder(orderId: string): Promise<PayPalResult<PayPalOrder>> {
      return run("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, orderSchema, asIs<PayPalOrder>);
    },

    async authorizeOrder(input: { orderId: string; requestId: string }): Promise<PayPalResult<AuthorizedOrder>> {
      const invalid = checkRequestId(input.requestId);
      if (invalid) return invalid;
      const path = `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/authorize`;
      return run<AuthorizedOrder>("POST", path, orderSchema, (order: PayPalOrder) => {
        const authorization = order.purchase_units?.[0]?.payments?.authorizations?.[0];
        if (authorization?.status === "CREATED") {
          return { outcome: "succeeded", data: { order, authorization } };
        }
        if (authorization?.status === "DENIED") {
          return { outcome: "failed", code: "AUTHORIZATION_DENIED", message: "PayPal denied the authorization" };
        }
        return { outcome: "unknown" };
      }, { body: "{}", requestId: input.requestId });
    },

    getAuthorization(authorizationId: string): Promise<PayPalResult<PayPalAuthorization>> {
      const path = `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`;
      return run("GET", path, authorizationSchema, asIs<PayPalAuthorization>);
    },

    async captureAuthorization(input: {
      authorizationId: string;
      requestId: string;
      amount: Money;
      invoiceId?: string;
      finalCapture?: boolean;
    }): Promise<PayPalResult<PayPalCapture>> {
      const invalid = checkRequestId(input.requestId) ?? checkAmount(input.amount);
      if (invalid) return invalid;
      const path = `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/capture`;
      const body = JSON.stringify({
        amount: toPayPalAmount(input.amount),
        final_capture: input.finalCapture ?? false,
        invoice_id: input.invoiceId,
      });
      return run<PayPalCapture>("POST", path, captureSchema, (capture: PayPalCapture) => {
        if (capture.status === "COMPLETED") return { outcome: "succeeded", data: capture };
        if (capture.status === "DECLINED" || capture.status === "FAILED") {
          return { outcome: "failed", code: `CAPTURE_${capture.status}`, message: `Capture ${capture.status.toLowerCase()}` };
        }
        return { outcome: "unknown" };
      }, { body, requestId: input.requestId });
    },

    getCapture(captureId: string): Promise<PayPalResult<PayPalCapture>> {
      return run("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`, captureSchema, asIs<PayPalCapture>);
    },

    async voidAuthorization(input: {
      authorizationId: string;
      requestId: string;
    }): Promise<PayPalResult<VoidedAuthorization>> {
      const invalid = checkRequestId(input.requestId);
      if (invalid) return invalid;
      const path = `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/void`;
      // PayPal answers 204 with no body, or 200 with the voided authorization.
      const schema = z.union([z.undefined(), authorizationSchema]);
      return run<VoidedAuthorization>("POST", path, schema, (authorization: PayPalAuthorization | undefined) => {
        if (authorization === undefined) return { outcome: "succeeded", data: {} };
        if (authorization.status === "VOIDED") return { outcome: "succeeded", data: { authorization } };
        return { outcome: "unknown" };
      }, { requestId: input.requestId });
    },

    async reauthorizeAuthorization(input: {
      authorizationId: string;
      requestId: string;
      amount?: Money;
    }): Promise<PayPalResult<PayPalAuthorization>> {
      const invalid = checkRequestId(input.requestId) ?? (input.amount ? checkAmount(input.amount) : undefined);
      if (invalid) return invalid;
      const path = `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/reauthorize`;
      const body = JSON.stringify(input.amount ? { amount: toPayPalAmount(input.amount) } : {});
      return run<PayPalAuthorization>("POST", path, authorizationSchema, (authorization: PayPalAuthorization) => {
        if (authorization.status === "CREATED") return { outcome: "succeeded", data: authorization };
        if (authorization.status === "DENIED") {
          return { outcome: "failed", code: "REAUTHORIZATION_DENIED", message: "PayPal denied the reauthorization" };
        }
        return { outcome: "unknown" };
      }, { body, requestId: input.requestId });
    },

    /** Refunds the whole capture. PayPal treats an empty body as a full refund. */
    async refundCapture(input: { captureId: string; requestId: string }): Promise<PayPalResult<PayPalRefund>> {
      const invalid = checkRequestId(input.requestId);
      if (invalid) return invalid;
      const path = `/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`;
      return run<PayPalRefund>("POST", path, refundSchema, (refund: PayPalRefund) => {
        if (refund.status === "COMPLETED") return { outcome: "succeeded", data: refund };
        if (refund.status === "FAILED" || refund.status === "CANCELLED") {
          return { outcome: "failed", code: `REFUND_${refund.status}`, message: `Refund ${refund.status.toLowerCase()}` };
        }
        return { outcome: "unknown" };
      }, { body: "{}", requestId: input.requestId });
    },

    /**
     * Asks PayPal to verify a webhook. Pass the raw request body exactly as
     * received: it is sent unchanged, because re-serializing can alter the
     * bytes PayPal signed. Callers trust the event only on `succeeded`.
     */
    async verifyWebhookSignature(input: {
      rawBody: string;
      headers: HeaderSource;
    }): Promise<PayPalResult<{ verified: true }>> {
      const get = (name: string) => input.headers.get(name)?.trim() || undefined;
      const fields = {
        auth_algo: get("paypal-auth-algo"),
        cert_url: get("paypal-cert-url"),
        transmission_id: get("paypal-transmission-id"),
        transmission_sig: get("paypal-transmission-sig"),
        transmission_time: get("paypal-transmission-time"),
      };
      if (Object.values(fields).some((value) => value === undefined)) {
        return definiteFailure("missing_signature_headers", "A PayPal signature header is missing");
      }
      if (!config.webhookId) {
        return definiteFailure("missing_webhook_id", "No webhook ID is configured");
      }
      // Only a JSON object may be spliced in, so a crafted body can't change the outer request.
      const event = parseJson(input.rawBody);
      if (!event.ok || typeof event.value !== "object" || event.value === null || Array.isArray(event.value)) {
        return definiteFailure("invalid_webhook_body", "The webhook body is not a JSON object");
      }
      const outer = JSON.stringify({ ...fields, webhook_id: config.webhookId });
      const body = `${outer.slice(0, -1)},"webhook_event":${input.rawBody}}`;
      return run<{ verified: true }>("POST", "/v1/notifications/verify-webhook-signature", verificationSchema, (result: { verification_status: string }) => {
        if (result.verification_status === "SUCCESS") return { outcome: "succeeded", data: { verified: true as const } };
        if (result.verification_status === "FAILURE") {
          return { outcome: "failed", code: "signature_invalid", message: "PayPal rejected the webhook signature" };
        }
        return { outcome: "unknown" };
      }, { body });
    },
  };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;

function classify<T>(
  reply: Reply,
  schema: z.ZodType,
  interpret: (data: never) => Interpretation<T>,
): PayPalResult<T> {
  if (reply.kind === "unknown") return { outcome: "unknown", reason: reply.reason };
  const { status, debugId } = reply;

  if (status >= 200 && status < 300) {
    const json = parseJson(reply.text);
    const parsed = json.ok ? schema.safeParse(json.value) : undefined;
    if (!parsed?.success) return { outcome: "unknown", reason: "unreadable_response", httpStatus: status, debugId };
    const meaning = interpret(parsed.data as never);
    if (meaning.outcome === "succeeded") return { outcome: "succeeded", data: meaning.data, httpStatus: status, debugId };
    if (meaning.outcome === "failed") return { ...meaning, httpStatus: status, debugId };
    return { outcome: "unknown", reason: "unclear_status", httpStatus: status, debugId };
  }

  if (status === 400 || status === 403 || status === 404 || status === 422) {
    const json = parseJson(reply.text);
    const parsed = json.ok ? errorSchema.safeParse(json.value) : undefined;
    if (!parsed?.success) return { outcome: "unknown", reason: "unreadable_response", httpStatus: status, debugId };

    const error = parsed.data;
    const id = error.debug_id ?? debugId;
    const issues = (error.details ?? []).flatMap((detail) => (detail.issue ? [detail.issue] : []));
    const code = issues[0] ?? error.name;
    const message = error.message ?? error.name;

    if (issues.some((issue) => ALREADY_DONE_ISSUES.has(issue))) {
      return { outcome: "unknown", reason: "unrecognized_error", httpStatus: status, debugId: id };
    }
    if (status !== 422) return { outcome: "failed", code, message, httpStatus: status, debugId: id };

    if (issues.length > 0 && issues.every((issue) => UNSUPPORTED_ISSUES.has(issue))) {
      return { outcome: "unsupported", code, message, httpStatus: status, debugId: id };
    }
    if (issues.length > 0 && issues.every((issue) => DEFINITE_FAILURE_ISSUES.has(issue))) {
      return { outcome: "failed", code, message, httpStatus: status, debugId: id };
    }
    return { outcome: "unknown", reason: "unrecognized_error", httpStatus: status, debugId: id };
  }

  return { outcome: "unknown", reason: unknownReasonFor(status), httpStatus: status, debugId };
}

function unknownReasonFor(status: number): UnknownReason {
  if (status === 401) return "auth_unavailable";
  if (status === 408) return "timeout";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "unexpected_status";
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function definiteFailure(code: string, message: string): PayPalResult<never> {
  return { outcome: "failed", code, message };
}

/** Without the header PayPal duplicates a request, so a blank ID is never sent. */
function checkRequestId(requestId: string): PayPalResult<never> | undefined {
  if (typeof requestId === "string" && requestId.trim() !== "") return undefined;
  return definiteFailure("invalid_request_id", "A PayPal-Request-Id is required");
}

function checkAmount(amount: Money): PayPalResult<never> | undefined {
  const valid = amount.currencyCode === "USD" && AMOUNT_PATTERN.test(amount.value) && Number(amount.value) > 0;
  return valid ? undefined : definiteFailure("invalid_amount", "The amount must be a positive USD value");
}

function toPayPalAmount(amount: Money) {
  return { currency_code: amount.currencyCode, value: amount.value };
}
