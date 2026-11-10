import { describe, expect, it, vi } from "vitest";
import {
  createPayPalClient,
  PAYPAL_SANDBOX_BASE_URL,
  type PayPalClient,
  type PayPalClientConfig,
  type PayPalResult,
} from "./paypal-client";

// Synthetic values only. No real credentials or PayPal data.
const config = { clientId: "test-client", clientSecret: "test-secret", webhookId: "WH-TEST" };
const usd = (value: string) => ({ currencyCode: "USD" as const, value });

type Step = Response | Error | ((init: RequestInit) => Promise<Response>);

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function text(status: number, body: string) {
  return new Response(body, { status });
}

function tokenReply(token = "token-1", expiresIn = 32_000) {
  return json(200, { access_token: token, token_type: "Bearer", expires_in: expiresIn });
}

function paypalError(status: number, name: string, issues: string[] = []) {
  return json(status, {
    name,
    message: `${name} message`,
    debug_id: "debug-1",
    details: issues.map((issue) => ({ issue })),
  });
}

/** A fetch that answers the token endpoint itself and replays `api` for every other call. */
function setup(api: Step[], options: { tokens?: Step[]; config?: Partial<PayPalClientConfig> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const tokens = options.tokens;
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const queue = url.endsWith("/v1/oauth2/token") ? tokens : api;
    if (queue === undefined) return tokenReply();
    const step = queue.shift();
    if (step === undefined) throw new Error(`No scripted reply for ${url}`);
    if (step instanceof Error) throw step;
    if (typeof step === "function") return step(init);
    return step;
  });
  const client = createPayPalClient({ ...config, fetch: fetchMock as typeof fetch, ...options.config });
  const apiCalls = () => calls.filter((call) => !call.url.endsWith("/v1/oauth2/token"));
  const tokenCalls = () => calls.filter((call) => call.url.endsWith("/v1/oauth2/token"));
  return { client, calls, apiCalls, tokenCalls, fetchMock };
}

function header(init: RequestInit, name: string) {
  return new Headers(init.headers).get(name);
}

const approveLink = { href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1", rel: "payer-action" };

function order(status: string, extra: Record<string, unknown> = {}) {
  return { id: "ORDER-1", status, links: [approveLink], ...extra };
}

function authorizedOrder(authorizationStatus: string) {
  return order("COMPLETED", {
    purchase_units: [
      { payments: { authorizations: [{ id: "AUTH-1", status: authorizationStatus, amount: { currency_code: "USD", value: "150.00" } }] } },
    ],
  });
}

const authorization = (status: string) => ({ id: "AUTH-1", status, amount: { currency_code: "USD", value: "150.00" } });
const capture = (status: string) => ({ id: "CAP-1", status, amount: { currency_code: "USD", value: "12.50" } });
const refund = (status: string) => ({ id: "REF-1", status, amount: { currency_code: "USD", value: "12.50" } });

const webhookHeaders = () =>
  new Headers({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "TX-1",
    "paypal-transmission-sig": "c2lnbmF0dXJl",
    "paypal-transmission-time": "2026-11-10T00:00:00Z",
  });

const rawWebhook = '{"id":"WH-EVENT-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"1.10"}}}';

type Operation = {
  name: string;
  write: boolean;
  invoke: (client: PayPalClient) => Promise<PayPalResult<unknown>>;
  success: () => Response;
};

const operations: Operation[] = [
  {
    name: "createOrder",
    write: true,
    invoke: (c) =>
      c.createOrder({
        requestId: "kitty-order-p1",
        amount: usd("150.00"),
        returnUrl: "http://localhost:3000/return",
        cancelUrl: "http://localhost:3000/cancel",
      }),
    success: () => json(200, order("PAYER_ACTION_REQUIRED")),
  },
  { name: "getOrder", write: false, invoke: (c) => c.getOrder("ORDER-1"), success: () => json(200, order("APPROVED")) },
  {
    name: "authorizeOrder",
    write: true,
    invoke: (c) => c.authorizeOrder({ orderId: "ORDER-1", requestId: "kitty-auth-p1" }),
    success: () => json(201, authorizedOrder("CREATED")),
  },
  {
    name: "getAuthorization",
    write: false,
    invoke: (c) => c.getAuthorization("AUTH-1"),
    success: () => json(200, authorization("PARTIALLY_CAPTURED")),
  },
  {
    name: "captureAuthorization",
    write: true,
    invoke: (c) => c.captureAuthorization({ authorizationId: "AUTH-1", requestId: "kitty-capture-u1", amount: usd("12.50") }),
    success: () => json(201, capture("COMPLETED")),
  },
  { name: "getCapture", write: false, invoke: (c) => c.getCapture("CAP-1"), success: () => json(200, capture("PENDING")) },
  {
    name: "voidAuthorization",
    write: true,
    invoke: (c) => c.voidAuthorization({ authorizationId: "AUTH-1", requestId: "kitty-void-a1" }),
    success: () => new Response(null, { status: 204 }),
  },
  {
    name: "reauthorizeAuthorization",
    write: true,
    invoke: (c) => c.reauthorizeAuthorization({ authorizationId: "AUTH-1", requestId: "kitty-reauth-a1" }),
    success: () => json(201, { ...authorization("CREATED"), id: "AUTH-2" }),
  },
  {
    name: "refundCapture",
    write: true,
    invoke: (c) => c.refundCapture({ captureId: "CAP-1", requestId: "kitty-refund-u1" }),
    success: () => json(201, refund("COMPLETED")),
  },
  {
    name: "verifyWebhookSignature",
    write: false,
    invoke: (c) => c.verifyWebhookSignature({ rawBody: rawWebhook, headers: webhookHeaders() }),
    success: () => json(200, { verification_status: "SUCCESS" }),
  },
];

const writes = operations.filter((operation) => operation.write);

/** Never settles until the client's timeout aborts it. */
const hang = (init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

/** Headers arrive, then the connection drops while the body is read. */
const dropDuringBody = () =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated"));
      },
    }),
    { status: 200 },
  );

const unclearReplies: [string, () => Step, string][] = [
  ["a timeout", () => hang, "timeout"],
  ["a dropped connection", () => new TypeError("fetch failed"), "network"],
  ["a connection dropped during the body", () => dropDuringBody(), "network"],
  ["a 500", () => paypalError(500, "INTERNAL_SERVER_ERROR"), "server_error"],
  ["a 502 with an HTML body", () => text(502, "<html>Bad gateway</html>"), "server_error"],
  ["a 503", () => paypalError(503, "SERVICE_UNAVAILABLE"), "server_error"],
  ["a redirect", () => new Response(null, { status: 302, headers: { Location: "https://example.test" } }), "unexpected_status"],
  ["a 408", () => text(408, ""), "timeout"],
  ["a 409 request in progress", () => paypalError(409, "RESOURCE_CONFLICT", ["PREVIOUS_REQUEST_IN_PROGRESS"]), "conflict"],
  ["a 429", () => paypalError(429, "RATE_LIMIT_REACHED"), "rate_limited"],
  ["a 200 that is not JSON", () => text(200, "<html>ok</html>"), "unreadable_response"],
  ["a 200 that doesn't fit the schema", () => json(200, { unexpected: true }), "unreadable_response"],
  ["a 404 with an HTML body", () => text(404, "<html>Not found</html>"), "unreadable_response"],
  ["a 400 with a non-PayPal body", () => json(400, { error: "bad" }), "unreadable_response"],
  ["a 422 with an unrecognized issue", () => paypalError(422, "UNPROCESSABLE_ENTITY", ["SOMETHING_NEW"]), "unrecognized_error"],
  ["a 422 with no issue", () => paypalError(422, "UNPROCESSABLE_ENTITY"), "unrecognized_error"],
  ["a 422 duplicate invoice", () => paypalError(422, "UNPROCESSABLE_ENTITY", ["DUPLICATE_INVOICE_ID"]), "unrecognized_error"],
  ["a 400 already-done issue", () => paypalError(400, "INVALID_REQUEST", ["ORDER_ALREADY_AUTHORIZED"]), "unrecognized_error"],
  [
    "a 422 mixing a decline and an unrecognized issue",
    () => paypalError(422, "UNPROCESSABLE_ENTITY", ["INSTRUMENT_DECLINED", "SOMETHING_NEW"]),
    "unrecognized_error",
  ],
];

describe("PayPal client", () => {
  describe.each(operations)("$name", (operation) => {
    it("succeeds on a clear success", async () => {
      const { client } = setup([operation.success()]);
      const result = await operation.invoke(client);
      expect(result.outcome).toBe("succeeded");
    });

    it.each(unclearReplies)("is unknown after %s", async (_label, reply, reason) => {
      const { client } = setup([reply()], { config: { timeoutMs: 20 } });
      const result = await operation.invoke(client);
      expect(result).toMatchObject({ outcome: "unknown", reason });
    });

    it("is unknown when 401 persists after a token refresh", async () => {
      const unauthorized = () => paypalError(401, "AUTHENTICATION_FAILURE");
      const { client, tokenCalls } = setup([unauthorized(), unauthorized()]);
      const result = await operation.invoke(client);
      expect(result).toMatchObject({ outcome: "unknown", reason: "auth_unavailable" });
      expect(tokenCalls()).toHaveLength(2);
    });

    it("is unknown and sends nothing when no token can be fetched", async () => {
      const { client, apiCalls } = setup([], { tokens: [paypalError(500, "INTERNAL_SERVER_ERROR")] });
      const result = await operation.invoke(client);
      expect(result).toMatchObject({ outcome: "unknown", reason: "auth_unavailable" });
      expect(apiCalls()).toHaveLength(0);
    });

    it("is failed on a 400, 403 or 404 with a PayPal error body", async () => {
      for (const [status, name] of [
        [400, "INVALID_REQUEST"],
        [403, "NOT_AUTHORIZED"],
        [404, "RESOURCE_NOT_FOUND"],
      ] as const) {
        const { client } = setup([paypalError(status, name, ["SOME_ISSUE"])]);
        const result = await operation.invoke(client);
        expect(result).toMatchObject({ outcome: "failed", code: "SOME_ISSUE", httpStatus: status, debugId: "debug-1" });
      }
    });

    it("only goes to the sandbox host", async () => {
      const { client, calls } = setup([operation.success()]);
      await operation.invoke(client);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call.url.startsWith(`${PAYPAL_SANDBOX_BASE_URL}/`)).toBe(true);
    });
  });

  describe("422 issue lists", () => {
    it("is unsupported when every issue is on the unsupported list", async () => {
      const { client } = setup([paypalError(422, "UNPROCESSABLE_ENTITY", ["AUTH_CAPTURE_NOT_ENABLED"])]);
      const result = await client.captureAuthorization({ authorizationId: "AUTH-1", requestId: "r1", amount: usd("1.00") });
      expect(result).toMatchObject({ outcome: "unsupported", code: "AUTH_CAPTURE_NOT_ENABLED", httpStatus: 422 });
    });

    it("treats a reauthorization inside the honor period as unsupported (seen in S06b)", async () => {
      const { client } = setup([paypalError(422, "UNPROCESSABLE_ENTITY", ["REAUTHORIZATION_TOO_SOON"])]);
      const result = await client.reauthorizeAuthorization({ authorizationId: "AUTH-1", requestId: "r1", amount: usd("51.00") });
      expect(result).toMatchObject({ outcome: "unsupported", code: "REAUTHORIZATION_TOO_SOON", httpStatus: 422 });
    });

    it("is failed when every issue is a definite failure", async () => {
      const { client } = setup([paypalError(422, "UNPROCESSABLE_ENTITY", ["INSTRUMENT_DECLINED"])]);
      const result = await client.captureAuthorization({ authorizationId: "AUTH-1", requestId: "r1", amount: usd("1.00") });
      expect(result).toMatchObject({ outcome: "failed", code: "INSTRUMENT_DECLINED" });
    });

    it("never fails a 400 or 404 carrying an already-done issue", async () => {
      for (const status of [400, 404]) {
        const { client } = setup([paypalError(status, "INVALID_REQUEST", ["PREVIOUSLY_CAPTURED"])]);
        const result = await client.captureAuthorization({ authorizationId: "AUTH-1", requestId: "r1", amount: usd("1.00") });
        expect(result.outcome).toBe("unknown");
      }
    });
  });

  describe("status mapping on writes", () => {
    const capturing = (c: PayPalClient) =>
      c.captureAuthorization({ authorizationId: "AUTH-1", requestId: "r1", amount: usd("12.50") });
    const authorizing = (c: PayPalClient) => c.authorizeOrder({ orderId: "ORDER-1", requestId: "r1" });
    const reauthorizing = (c: PayPalClient) => c.reauthorizeAuthorization({ authorizationId: "AUTH-1", requestId: "r1" });
    const refunding = (c: PayPalClient) => c.refundCapture({ captureId: "CAP-1", requestId: "r1" });
    const voiding = (c: PayPalClient) => c.voidAuthorization({ authorizationId: "AUTH-1", requestId: "r1" });
    const creating = (c: PayPalClient) =>
      c.createOrder({ requestId: "r1", amount: usd("150.00"), returnUrl: "http://localhost/r", cancelUrl: "http://localhost/c" });

    const rows: [string, (c: PayPalClient) => Promise<PayPalResult<unknown>>, () => Response, string][] = [
      ["create order CREATED with approve link", creating, () => json(201, { ...order("CREATED"), links: [{ href: "https://a.test", rel: "approve" }] }), "succeeded"],
      ["create order PAYER_ACTION_REQUIRED", creating, () => json(200, order("PAYER_ACTION_REQUIRED")), "succeeded"],
      ["create order with no approval link", creating, () => json(200, { ...order("CREATED"), links: [] }), "unknown"],
      ["create order already APPROVED", creating, () => json(200, order("APPROVED")), "unknown"],
      ["authorize CREATED", authorizing, () => json(201, authorizedOrder("CREATED")), "succeeded"],
      ["authorize DENIED", authorizing, () => json(201, authorizedOrder("DENIED")), "failed"],
      ["authorize PENDING", authorizing, () => json(201, authorizedOrder("PENDING")), "unknown"],
      ["authorize with no nested authorization", authorizing, () => json(201, order("COMPLETED")), "unknown"],
      ["capture COMPLETED", capturing, () => json(201, capture("COMPLETED")), "succeeded"],
      ["capture DECLINED", capturing, () => json(201, capture("DECLINED")), "failed"],
      ["capture FAILED", capturing, () => json(201, capture("FAILED")), "failed"],
      ["capture PENDING", capturing, () => json(201, capture("PENDING")), "unknown"],
      ["capture replay now REFUNDED", capturing, () => json(200, capture("REFUNDED")), "unknown"],
      ["void 204", voiding, () => new Response(null, { status: 204 }), "succeeded"],
      ["void 200 VOIDED", voiding, () => json(200, authorization("VOIDED")), "succeeded"],
      ["void 200 CAPTURED", voiding, () => json(200, authorization("CAPTURED")), "unknown"],
      ["reauthorize CREATED", reauthorizing, () => json(201, authorization("CREATED")), "succeeded"],
      ["reauthorize DENIED", reauthorizing, () => json(201, authorization("DENIED")), "failed"],
      ["reauthorize PENDING", reauthorizing, () => json(201, authorization("PENDING")), "unknown"],
      ["refund COMPLETED", refunding, () => json(201, refund("COMPLETED")), "succeeded"],
      ["refund FAILED", refunding, () => json(201, refund("FAILED")), "failed"],
      ["refund CANCELLED", refunding, () => json(201, refund("CANCELLED")), "failed"],
      ["refund PENDING", refunding, () => json(201, refund("PENDING")), "unknown"],
    ];

    it.each(rows)("%s is %s", async (_label, invoke, reply, outcome) => {
      const { client } = setup([reply()]);
      expect((await invoke(client)).outcome).toBe(outcome);
    });

    it("returns the approval link and the authorization", async () => {
      const created = setup([json(200, order("PAYER_ACTION_REQUIRED"))]);
      expect(await creating(created.client)).toMatchObject({ outcome: "succeeded", data: { approvalUrl: approveLink.href } });

      const authorized = setup([json(201, authorizedOrder("CREATED"))]);
      expect(await authorizing(authorized.client)).toMatchObject({
        outcome: "succeeded",
        data: { authorization: { id: "AUTH-1", amount: { value: "150.00" } } },
      });
    });

    it("reads succeed whatever the resource status", async () => {
      const { client } = setup([json(200, capture("DECLINED"))]);
      expect(await client.getCapture("CAP-1")).toMatchObject({ outcome: "succeeded", data: { status: "DECLINED" } });
    });
  });

  describe("request IDs", () => {
    it.each(writes)("$name sends its PayPal-Request-Id and asks for the full representation", async (operation) => {
      const { client, apiCalls } = setup([operation.success()]);
      await operation.invoke(client);
      const [call] = apiCalls();
      expect(header(call.init, "PayPal-Request-Id")).toMatch(/^kitty-/);
      expect(header(call.init, "Prefer")).toBe("return=representation");
      expect(call.init.method).toBe("POST");
    });

    it("reads send no request ID", async () => {
      const { client, apiCalls } = setup([json(200, capture("COMPLETED"))]);
      await client.getCapture("CAP-1");
      expect(header(apiCalls()[0].init, "PayPal-Request-Id")).toBeNull();
      expect(apiCalls()[0].init.method).toBe("GET");
    });

    it("retries a 401 once with a fresh token and the same request ID", async () => {
      const { client, apiCalls } = setup([paypalError(401, "AUTHENTICATION_FAILURE"), json(201, capture("COMPLETED"))], {
        tokens: [tokenReply("token-old"), tokenReply("token-new")],
      });
      const result = await client.captureAuthorization({ authorizationId: "AUTH-1", requestId: "kitty-capture-u1", amount: usd("12.50") });
      expect(result.outcome).toBe("succeeded");
      const [first, second] = apiCalls();
      expect(header(first.init, "PayPal-Request-Id")).toBe("kitty-capture-u1");
      expect(header(second.init, "PayPal-Request-Id")).toBe("kitty-capture-u1");
      expect(header(first.init, "Authorization")).toBe("Bearer token-old");
      expect(header(second.init, "Authorization")).toBe("Bearer token-new");
    });

    const blankRequests: Record<string, (client: PayPalClient) => Promise<PayPalResult<unknown>>> = {
      createOrder: (c) => c.createOrder({ requestId: " ", amount: usd("1.00"), returnUrl: "http://l/r", cancelUrl: "http://l/c" }),
      authorizeOrder: (c) => c.authorizeOrder({ orderId: "ORDER-1", requestId: "" }),
      captureAuthorization: (c) => c.captureAuthorization({ authorizationId: "AUTH-1", requestId: "", amount: usd("1.00") }),
      voidAuthorization: (c) => c.voidAuthorization({ authorizationId: "AUTH-1", requestId: "" }),
      reauthorizeAuthorization: (c) => c.reauthorizeAuthorization({ authorizationId: "AUTH-1", requestId: "" }),
      refundCapture: (c) => c.refundCapture({ captureId: "CAP-1", requestId: "" }),
    };

    it.each(writes)("$name sends nothing with a blank request ID", async (operation) => {
      const { client, fetchMock } = setup([]);
      expect(await blankRequests[operation.name](client)).toMatchObject({ outcome: "failed", code: "invalid_request_id" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("request bodies", () => {
    it("creates an AUTHORIZE order with return and cancel URLs", async () => {
      const { client, apiCalls } = setup([json(200, order("PAYER_ACTION_REQUIRED"))]);
      await client.createOrder({
        requestId: "kitty-order-p1",
        amount: usd("150.00"),
        returnUrl: "http://localhost:3000/return",
        cancelUrl: "http://localhost:3000/cancel",
        invoiceId: "pool-p1",
      });
      const body = JSON.parse(String(apiCalls()[0].init.body));
      expect(body).toMatchObject({
        intent: "AUTHORIZE",
        purchase_units: [{ amount: { currency_code: "USD", value: "150.00" }, invoice_id: "pool-p1" }],
        payment_source: {
          paypal: { experience_context: { return_url: "http://localhost:3000/return", cancel_url: "http://localhost:3000/cancel" } },
        },
      });
    });

    it("captures a partial amount with final_capture false by default", async () => {
      const { client, apiCalls } = setup([json(201, capture("COMPLETED"))]);
      await client.captureAuthorization({ authorizationId: "AUTH-1", requestId: "r1", amount: usd("12.50"), invoiceId: "purchase-u1" });
      expect(JSON.parse(String(apiCalls()[0].init.body))).toEqual({
        amount: { currency_code: "USD", value: "12.50" },
        final_capture: false,
        invoice_id: "purchase-u1",
      });
    });

    it("refunds the whole capture with an empty body", async () => {
      const { client, apiCalls } = setup([json(201, refund("COMPLETED"))]);
      await client.refundCapture({ captureId: "CAP-1", requestId: "r1" });
      expect(apiCalls()[0].init.body).toBe("{}");
    });

    it("encodes IDs in the path", async () => {
      const { client, apiCalls } = setup([json(200, capture("COMPLETED"))]);
      await client.getCapture("../v1/oauth2/token");
      expect(apiCalls()[0].url).toBe(`${PAYPAL_SANDBOX_BASE_URL}/v2/payments/captures/..%2Fv1%2Foauth2%2Ftoken`);
    });

    it.each(["0", "0.00", "-1.00", "1.234", "abc", ""])("sends nothing for the amount %j", async (value) => {
      const { client, fetchMock } = setup([]);
      const result = await client.captureAuthorization({ authorizationId: "AUTH-1", requestId: "r1", amount: usd(value) });
      expect(result).toMatchObject({ outcome: "failed", code: "invalid_amount" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("access token", () => {
    it("fetches the token with Basic auth and caches it", async () => {
      const { client, tokenCalls } = setup([json(200, capture("COMPLETED")), json(200, capture("COMPLETED"))]);
      await client.getCapture("CAP-1");
      await client.getCapture("CAP-1");
      expect(tokenCalls()).toHaveLength(1);
      const [call] = tokenCalls();
      expect(header(call.init, "Authorization")).toBe(`Basic ${Buffer.from("test-client:test-secret").toString("base64")}`);
      expect(call.init.body).toBe("grant_type=client_credentials");
    });

    it("refreshes the token a minute before it expires", async () => {
      let clock = 0;
      const { client, tokenCalls } = setup(
        [json(200, capture("COMPLETED")), json(200, capture("COMPLETED")), json(200, capture("COMPLETED"))],
        { tokens: [tokenReply("t1", 120), tokenReply("t2", 120)], config: { now: () => clock } },
      );
      await client.getCapture("CAP-1");
      clock = 59_000;
      await client.getCapture("CAP-1");
      expect(tokenCalls()).toHaveLength(1);
      clock = 60_000;
      await client.getCapture("CAP-1");
      expect(tokenCalls()).toHaveLength(2);
    });

    it("shares one token fetch between concurrent calls", async () => {
      const { client, tokenCalls } = setup([json(200, capture("COMPLETED")), json(200, capture("COMPLETED"))]);
      await Promise.all([client.getCapture("CAP-1"), client.getCapture("CAP-1")]);
      expect(tokenCalls()).toHaveLength(1);
    });

    it("doesn't cache a failed token fetch", async () => {
      const { client, tokenCalls } = setup([json(200, capture("COMPLETED"))], {
        tokens: [new TypeError("fetch failed"), tokenReply()],
      });
      expect((await client.getCapture("CAP-1")).outcome).toBe("unknown");
      expect((await client.getCapture("CAP-1")).outcome).toBe("succeeded");
      expect(tokenCalls()).toHaveLength(2);
    });

    it("treats a malformed token response as unavailable", async () => {
      const { client, apiCalls } = setup([], { tokens: [json(200, { access_token: "" })] });
      expect(await client.getCapture("CAP-1")).toMatchObject({ outcome: "unknown", reason: "auth_unavailable" });
      expect(apiCalls()).toHaveLength(0);
    });
  });

  describe("sandbox only", () => {
    it("ignores any base URL passed at runtime", async () => {
      const { client, calls } = setup([json(200, capture("COMPLETED"))], {
        config: { baseUrl: "https://api-m.paypal.com" } as Partial<PayPalClientConfig>,
      });
      await client.getCapture("CAP-1");
      for (const call of calls) expect(call.url.startsWith("https://api-m.sandbox.paypal.com/")).toBe(true);
    });
  });

  describe("webhook signature verification", () => {
    it("sends the raw body unchanged with the signature headers", async () => {
      const { client, apiCalls } = setup([json(200, { verification_status: "SUCCESS" })]);
      const result = await client.verifyWebhookSignature({ rawBody: rawWebhook, headers: webhookHeaders() });
      expect(result).toMatchObject({ outcome: "succeeded", data: { verified: true } });

      const [call] = apiCalls();
      expect(call.url).toBe(`${PAYPAL_SANDBOX_BASE_URL}/v1/notifications/verify-webhook-signature`);
      const sent = String(call.init.body);
      expect(sent.endsWith(`"webhook_event":${rawWebhook}}`)).toBe(true);
      expect(JSON.parse(sent)).toEqual({
        auth_algo: "SHA256withRSA",
        cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
        transmission_id: "TX-1",
        transmission_sig: "c2lnbmF0dXJl",
        transmission_time: "2026-11-10T00:00:00Z",
        webhook_id: "WH-TEST",
        webhook_event: JSON.parse(rawWebhook),
      });
    });

    it.each([
      ["FAILURE", "failed"],
      ["PENDING", "unknown"],
    ])("treats %s as %s", async (status, outcome) => {
      const { client } = setup([json(200, { verification_status: status })]);
      const result = await client.verifyWebhookSignature({ rawBody: rawWebhook, headers: webhookHeaders() });
      expect(result.outcome).toBe(outcome);
    });

    it("fails without calling PayPal when a signature header is missing", async () => {
      const headers = webhookHeaders();
      headers.delete("paypal-transmission-sig");
      const { client, fetchMock } = setup([]);
      const result = await client.verifyWebhookSignature({ rawBody: rawWebhook, headers });
      expect(result).toMatchObject({ outcome: "failed", code: "missing_signature_headers" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ["invalid JSON", "{not json"],
      ["an array", "[]"],
      ["null", "null"],
      ["a body that tries to close the outer object", '{"a":1}},"webhook_id":"other"'],
    ])("fails without calling PayPal for %s", async (_label, rawBody) => {
      const { client, fetchMock } = setup([]);
      const result = await client.verifyWebhookSignature({ rawBody, headers: webhookHeaders() });
      expect(result).toMatchObject({ outcome: "failed", code: "invalid_webhook_body" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fails without calling PayPal when no webhook ID is configured", async () => {
      const { client, fetchMock } = setup([], { config: { webhookId: "" } });
      const result = await client.verifyWebhookSignature({ rawBody: rawWebhook, headers: webhookHeaders() });
      expect(result).toMatchObject({ outcome: "failed", code: "missing_webhook_id" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
