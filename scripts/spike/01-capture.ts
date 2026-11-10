/**
 * S05 spike: authorize once, then make many partial captures and replay one.
 * Answers architecture Q1, Q2 and the capture part of Q5. Sandbox only.
 *
 *   npx tsx scripts/spike/01-capture.ts start [--new]        create a $150 order, wait for approval, authorize
 *   npx tsx scripts/spike/01-capture.ts authorize            resume waiting for approval on the saved order
 *   npx tsx scripts/spike/01-capture.ts capture [--count N]  partial captures up to N in total (default 10)
 *   npx tsx scripts/spike/01-capture.ts replay [--label L] [--different-body]
 *   npx tsx scripts/spike/01-capture.ts status               re-read the authorization and order (no writes)
 *
 * Reads credentials from .env itself and never prints them. Raw, redacted
 * exchanges and saved IDs go to the gitignored .spike-logs/S05/ folder.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPayPalClient, type PayPalClient } from "../../src/adapters/payments/paypal-client";
import {
  MAX_CAPTURES,
  ORDER_AMOUNT,
  captureAmount,
  captureInvoiceId,
  captureRequestId,
  compareReplay,
  createLoggingFetch,
  plannedTotalCents,
  summarizeCapture,
  type CallSummary,
  type ReplayVerdict,
} from "./s05-helpers";

const LOG_DIR = join(".spike-logs", "S05");
const STATE_FILE = join(LOG_DIR, "state.json");
const APPROVAL_POLL_MS = 5_000;
const APPROVAL_WAIT_MS = 15 * 60_000;
const DIFFERENT_BODY_AMOUNT = "1.00";

type CaptureRecord = CallSummary & {
  n: number;
  at: string;
  requestId: string;
  invoiceId: string;
  requestedAmount: string;
};

type ReplayRecord = {
  label: string;
  at: string;
  variant: "same_body" | "different_body";
  requestId: string;
  sentAmount: string;
  result: CallSummary;
  verdict: ReplayVerdict;
  capturesBefore?: number;
  capturesAfter?: number;
  capturedCentsBefore?: number;
  capturedCentsAfter?: number;
};

type CheckRecord = {
  at: string;
  authorizationStatus?: string;
  authorizationAmount?: string;
  authorizationExpiresAt?: string;
  orderStatus?: string;
  captureCount?: number;
  capturedCents?: number;
  captureStatuses?: string[];
};

type State = {
  runId: string;
  startedAt: string;
  orderId?: string;
  orderRequestId?: string;
  approvalUrl?: string;
  authorizeRequestId?: string;
  authorizationId?: string;
  authorizationStatus?: string;
  authorizedAmount?: string;
  authorizationExpiresAt?: string;
  authorizeResult?: CallSummary;
  captures: CaptureRecord[];
  replays: ReplayRecord[];
  checks: CheckRecord[];
};

function loadState(): State | undefined {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State) : undefined;
}

function saveState(state: State) {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function requireState(): State {
  const state = loadState();
  if (!state) throw new Error(`No saved state in ${STATE_FILE}. Run "start" first.`);
  return state;
}

function requireAuthorization(state: State): string {
  if (!state.authorizationId) throw new Error('No authorization saved yet. Run "start" or "authorize" first.');
  return state.authorizationId;
}

function makeClient(): PayPalClient {
  try {
    process.loadEnvFile(".env");
  } catch {
    throw new Error("Could not load .env. Create it from .env.example (plan step S02).");
  }
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in .env.");

  const logFile = join(LOG_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const loggingFetch = createLoggingFetch(fetch, (entry) => appendFileSync(logFile, `${JSON.stringify(entry)}\n`));
  return createPayPalClient({
    clientId,
    clientSecret,
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
    fetch: loggingFetch,
  });
}

function toCents(value: string | undefined): number {
  return value === undefined ? 0 : Math.round(Number(value) * 100);
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads the authorization and the order's capture list. Prints only IDs, statuses and amounts. */
async function check(client: PayPalClient, state: State): Promise<CheckRecord> {
  const record: CheckRecord = { at: new Date().toISOString() };
  if (state.authorizationId) {
    const auth = await client.getAuthorization(state.authorizationId);
    if (auth.outcome === "succeeded") {
      record.authorizationStatus = auth.data.status;
      record.authorizationAmount = auth.data.amount?.value;
      record.authorizationExpiresAt = auth.data.expiration_time;
    } else {
      console.log(`  getAuthorization: ${auth.outcome}`, auth.outcome === "unknown" ? auth.reason : auth.code);
    }
  }
  if (state.orderId) {
    const order = await client.getOrder(state.orderId);
    if (order.outcome === "succeeded") {
      const captures = order.data.purchase_units?.[0]?.payments?.captures ?? [];
      record.orderStatus = order.data.status;
      record.captureCount = captures.length;
      record.capturedCents = captures
        .filter((capture) => capture.status === "COMPLETED" || capture.status === "PENDING")
        .reduce((sum, capture) => sum + toCents(capture.amount?.value), 0);
      record.captureStatuses = [...new Set(captures.map((capture) => capture.status))];
    } else {
      console.log(`  getOrder: ${order.outcome}`, order.outcome === "unknown" ? order.reason : order.code);
    }
  }
  state.checks.push(record);
  saveState(state);
  console.log(
    `  authorization ${state.authorizationId ?? "-"}: ${record.authorizationStatus ?? "?"}` +
      ` (amount ${record.authorizationAmount ?? "?"}, expires ${record.authorizationExpiresAt ?? "?"})`,
  );
  console.log(
    `  order ${state.orderId ?? "-"}: ${record.orderStatus ?? "?"}, ${record.captureCount ?? "?"} captures,` +
      ` ${record.capturedCents === undefined ? "?" : dollars(record.capturedCents)} captured` +
      ` [${record.captureStatuses?.join(", ") ?? ""}]`,
  );
  return record;
}

async function start(client: PayPalClient, flags: Flags) {
  const existing = loadState();
  if (existing?.authorizationId && !flags.new) {
    throw new Error(`Authorization ${existing.authorizationId} is already saved. Pass --new to start a fresh run.`);
  }
  const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const state: State = { runId, startedAt: new Date().toISOString(), captures: [], replays: [], checks: [] };
  state.orderRequestId = `s05-order-${runId}`;

  const created = await client.createOrder({
    requestId: state.orderRequestId,
    amount: { currencyCode: "USD", value: ORDER_AMOUNT },
    returnUrl: "https://example.com/kitty-spike/return",
    cancelUrl: "https://example.com/kitty-spike/cancel",
    invoiceId: `s05-${runId}-order`,
  });
  if (created.outcome !== "succeeded") {
    throw new Error(`createOrder ${created.outcome}: ${created.outcome === "unknown" ? created.reason : `${created.code} ${created.message}`}`);
  }
  state.orderId = created.data.order.id;
  state.approvalUrl = created.data.approvalUrl;
  saveState(state);

  console.log(`Order ${state.orderId} created for $${ORDER_AMOUNT} (status ${created.data.order.status}).`);
  console.log("\nApprove it with the sandbox buyer account:\n");
  console.log(`  ${state.approvalUrl}\n`);
  await waitAndAuthorize(client, state);
}

async function waitAndAuthorize(client: PayPalClient, state: State) {
  if (!state.orderId) throw new Error("No order saved.");
  if (state.authorizationId) {
    console.log(`Already authorized: ${state.authorizationId}`);
    return;
  }
  const deadline = Date.now() + APPROVAL_WAIT_MS;
  let lastStatus = "";
  console.log(`Waiting up to ${APPROVAL_WAIT_MS / 60_000} minutes for approval...`);
  while (true) {
    const order = await client.getOrder(state.orderId);
    const status = order.outcome === "succeeded" ? order.data.status : `(${order.outcome})`;
    if (status !== lastStatus) {
      console.log(`  ${new Date().toISOString()} order status: ${status}`);
      lastStatus = status;
    }
    if (status === "APPROVED") break;
    if (status === "VOIDED" || status === "COMPLETED") throw new Error(`Order ended as ${status} before authorization.`);
    if (Date.now() > deadline) throw new Error('Timed out waiting for approval. Approve, then run "authorize".');
    await sleep(APPROVAL_POLL_MS);
  }

  state.authorizeRequestId = `s05-authorize-${state.runId}`;
  const authorized = await client.authorizeOrder({ orderId: state.orderId, requestId: state.authorizeRequestId });
  if (authorized.outcome !== "succeeded") {
    state.authorizeResult =
      authorized.outcome === "unknown"
        ? { outcome: authorized.outcome, reason: authorized.reason, httpStatus: authorized.httpStatus, debugId: authorized.debugId }
        : { outcome: authorized.outcome, code: authorized.code, message: authorized.message, httpStatus: authorized.httpStatus, debugId: authorized.debugId };
    saveState(state);
    throw new Error(`authorizeOrder ${authorized.outcome}: ${JSON.stringify(state.authorizeResult)}`);
  }
  const auth = authorized.data.authorization;
  state.authorizationId = auth.id;
  state.authorizationStatus = auth.status;
  state.authorizedAmount = auth.amount?.value;
  state.authorizationExpiresAt = auth.expiration_time;
  state.authorizeResult = { outcome: "succeeded", status: auth.status, httpStatus: authorized.httpStatus, debugId: authorized.debugId };
  saveState(state);
  console.log(`\nAuthorization ${auth.id}: ${auth.status}, $${auth.amount?.value ?? "?"}, expires ${auth.expiration_time ?? "?"}`);
  console.log("Save this ID for S06b.");
}

async function capture(client: PayPalClient, flags: Flags) {
  const state = requireState();
  const authorizationId = requireAuthorization(state);
  const count = flags.count ?? 10;
  if (count < 1 || count > MAX_CAPTURES) throw new Error(`--count must be between 1 and ${MAX_CAPTURES}.`);
  const last = state.captures.at(-1);
  if (last && last.outcome !== "succeeded") {
    throw new Error(`Capture #${last.n} ended ${last.outcome} (${last.code ?? last.reason}). Not capturing further.`);
  }

  console.log(`Capturing up to ${count} in total (${dollars(plannedTotalCents(count))} planned) on ${authorizationId}.`);
  for (let n = state.captures.length + 1; n <= count; n++) {
    const requestId = captureRequestId(authorizationId, n);
    const invoiceId = captureInvoiceId(state.runId, n);
    const requestedAmount = captureAmount(n);
    const result = await client.captureAuthorization({
      authorizationId,
      requestId,
      amount: { currencyCode: "USD", value: requestedAmount },
      invoiceId,
      finalCapture: false,
    });
    const summary = summarizeCapture(result);
    state.captures.push({ n, at: new Date().toISOString(), requestId, invoiceId, requestedAmount, ...summary });
    saveState(state);
    console.log(
      `  #${n} $${requestedAmount} -> ${summary.outcome} ${summary.captureId ?? ""} ${summary.status ?? ""}` +
        ` ${summary.code ?? summary.reason ?? ""} (HTTP ${summary.httpStatus ?? "-"})`,
    );
    if (summary.outcome !== "succeeded") {
      console.log(`  Stopped: ${summary.message ?? summary.reason ?? ""} debug ${summary.debugId ?? "-"}`);
      break;
    }
  }
  console.log("After capturing:");
  await check(client, state);
}

async function replay(client: PayPalClient, flags: Flags) {
  const state = requireState();
  const authorizationId = requireAuthorization(state);
  const original = state.captures[0];
  if (!original || original.outcome !== "succeeded" || !original.captureId) {
    throw new Error('Capture #1 did not succeed, so there is nothing to replay. Run "capture" first.');
  }
  const label = flags.label ?? "now";
  const withDifferentBody = flags.differentBody || !state.replays.some((r) => r.variant === "different_body");

  console.log(`Replaying capture #1 (${original.captureId}, request ID ${original.requestId}) as "${label}".`);
  console.log(`  Original capture made at ${original.at}.`);
  const before = await check(client, state);

  const variants: { variant: ReplayRecord["variant"]; amount: string }[] = [
    { variant: "same_body", amount: original.requestedAmount },
  ];
  if (withDifferentBody) variants.push({ variant: "different_body", amount: DIFFERENT_BODY_AMOUNT });

  for (const { variant, amount } of variants) {
    const result = await client.captureAuthorization({
      authorizationId,
      requestId: original.requestId,
      amount: { currencyCode: "USD", value: amount },
      invoiceId: original.invoiceId,
      finalCapture: false,
    });
    const summary = summarizeCapture(result);
    const verdict = compareReplay(original.captureId, summary);
    state.replays.push({
      label,
      at: new Date().toISOString(),
      variant,
      requestId: original.requestId,
      sentAmount: amount,
      result: summary,
      verdict,
      capturesBefore: before.captureCount,
      capturedCentsBefore: before.capturedCents,
    });
    saveState(state);
    console.log(
      `  ${variant} ($${amount}) -> ${verdict}: ${summary.outcome} ${summary.captureId ?? ""} ${summary.status ?? ""}` +
        ` ${summary.amount ? `$${summary.amount}` : ""} ${summary.code ?? summary.reason ?? ""} (HTTP ${summary.httpStatus ?? "-"})`,
    );
  }

  console.log("After replaying:");
  const after = await check(client, state);
  for (const record of state.replays.slice(-variants.length)) {
    record.capturesAfter = after.captureCount;
    record.capturedCentsAfter = after.capturedCents;
  }
  saveState(state);
  const moved = after.capturedCents !== before.capturedCents || after.captureCount !== before.captureCount;
  console.log(moved ? "  WARNING: captured money changed during the replay." : "  No extra money moved.");
  await readBackCapture(client, original);
}

/** A replay response may echo the replayed request, so read PayPal's stored record. */
async function readBackCapture(client: PayPalClient, original: CaptureRecord) {
  if (!original.captureId) return;
  const stored = await client.getCapture(original.captureId);
  if (stored.outcome === "succeeded") {
    console.log(
      `  Stored capture ${stored.data.id}: ${stored.data.status} $${stored.data.amount?.value ?? "?"}` +
        ` (originally requested $${original.requestedAmount})`,
    );
  } else {
    console.log(`  getCapture: ${stored.outcome}`, stored.outcome === "unknown" ? stored.reason : stored.code);
  }
}

async function status(client: PayPalClient) {
  const state = requireState();
  console.log(`Run ${state.runId}, started ${state.startedAt}`);
  console.log(`  ${state.captures.length} captures recorded, ${state.replays.length} replays recorded`);
  for (const r of state.replays) console.log(`  replay ${r.label} ${r.variant}: ${r.verdict} at ${r.at}`);
  await check(client, state);
  const first = state.captures[0];
  if (first) await readBackCapture(client, first);
}

type Flags = { count?: number; label?: string; new?: boolean; differentBody?: boolean };

function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--new") flags.new = true;
    else if (arg === "--different-body") flags.differentBody = true;
    else if (arg === "--count") flags.count = Number(args[++i]);
    else if (arg === "--label") flags.label = args[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (flags.count !== undefined && !Number.isInteger(flags.count)) throw new Error("--count must be a whole number.");
  return flags;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  mkdirSync(LOG_DIR, { recursive: true });
  const client = makeClient();
  switch (command) {
    case "start":
      return start(client, flags);
    case "authorize":
      return waitAndAuthorize(client, requireState());
    case "capture":
      return capture(client, flags);
    case "replay":
      return replay(client, flags);
    case "status":
      return status(client);
    default:
      throw new Error("Usage: start [--new] | authorize | capture [--count N] | replay [--label L] [--different-body] | status");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
