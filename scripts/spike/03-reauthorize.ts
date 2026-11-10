/**
 * S06b spike: reauthorize a partly captured authorization, replay it, capture
 * on the new and the original authorization, then void. Answers architecture
 * Q3 and the rest of Q4. Sandbox only.
 *
 *   npx tsx scripts/spike/03-reauthorize.ts <authorization-id> check
 *   npx tsx scripts/spike/03-reauthorize.ts <authorization-id> reauthorize [--attempt N] [--amount X]
 *   npx tsx scripts/spike/03-reauthorize.ts <authorization-id> replay
 *   npx tsx scripts/spike/03-reauthorize.ts <authorization-id> capture
 *   npx tsx scripts/spike/03-reauthorize.ts <authorization-id> void
 *   npx tsx scripts/spike/03-reauthorize.ts <authorization-id> status
 *
 * Reads credentials from .env itself and never prints them. Raw, redacted
 * exchanges and saved IDs go to the gitignored .spike-logs/S06b/ folder.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPayPalClient,
  type PayPalAuthorization,
  type PayPalClient,
} from "../../src/adapters/payments/paypal-client";
import { createLoggingFetch, summarizeCapture, type CallSummary, type LogEntry } from "./s05-helpers";
import {
  captureRequestId,
  centsToValue,
  compareReauthReplay,
  extractIssue,
  honorEndsAt,
  hoursBetween,
  reauthRequestId,
  remainingCents,
  summarizeAuthorization,
  toCents,
  voidRequestId,
  type AuthorizationSummary,
  type PayPalIssue,
  type ReauthReplayVerdict,
} from "./s06b-helpers";

const LOG_DIR = join(".spike-logs", "S06b");
const S05_STATE_FILE = join(".spike-logs", "S05", "state.json");
const NEW_AUTH_CAPTURE = "2.00";
const ORIGINAL_PROBE_CAPTURE = "1.00";

type Attempt = {
  attempt: number;
  at: string;
  hoursSinceCreate?: number;
  requestId: string;
  sentAmount: string;
  result: AuthorizationSummary;
  issue?: PayPalIssue;
};

type Replay = { at: string; requestId: string; sentAmount: string; result: AuthorizationSummary; issue?: PayPalIssue; verdict: ReauthReplayVerdict | "same_refusal" | "different_refusal" };

type Capture = { at: string; on: "new" | "original"; authorizationId: string; requestId: string; requestedAmount: string; result: CallSummary; issue?: PayPalIssue };

type VoidRecord = { at: string; on: "new" | "original"; authorizationId: string; requestId: string; replay: boolean; result: CallSummary; issue?: PayPalIssue };

type AuthCheck = { id: string; status?: string; amount?: string; createTime?: string; expiresAt?: string; outcome: string };

type Check = { at: string; original?: AuthCheck; current?: AuthCheck; orderStatus?: string; captureCount?: number; capturedCents?: number; remainingCents?: number };

type State = {
  originalId: string;
  orderId?: string;
  originalCreateTime?: string;
  originalExpiresAt?: string;
  newAuthorizationId?: string;
  attempts: Attempt[];
  replays: Replay[];
  captures: Capture[];
  voids: VoidRecord[];
  checks: Check[];
};

/** Keeps the latest logged exchange so a refusal's issue code can be recorded. */
let lastEntry: LogEntry | undefined;

function stateFile(authorizationId: string) {
  return join(LOG_DIR, `state-${authorizationId}.json`);
}

function loadState(authorizationId: string): State {
  const file = stateFile(authorizationId);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as State;
  return { originalId: authorizationId, attempts: [], replays: [], captures: [], voids: [], checks: [] };
}

function saveState(state: State) {
  writeFileSync(stateFile(state.originalId), `${JSON.stringify(state, null, 2)}\n`);
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
  const loggingFetch = createLoggingFetch(fetch, (entry) => {
    lastEntry = entry;
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  });
  return createPayPalClient({ clientId, clientSecret, webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "", fetch: loggingFetch });
}

/** The issue PayPal named in the last response, for calls that did not succeed. */
function lastIssue(outcome: string): PayPalIssue | undefined {
  return outcome === "succeeded" ? undefined : extractIssue(lastEntry?.responseBody);
}

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function describe(summary: CallSummary & { authorizationId?: string }, issue?: PayPalIssue) {
  const id = summary.authorizationId ?? summary.captureId ?? "";
  const detail = summary.code ?? summary.reason ?? "";
  const named = issue ? ` [${issue.name ?? ""}${issue.issue ? ` / ${issue.issue}` : ""}]` : "";
  return `${summary.outcome} ${id} ${summary.status ?? ""} ${summary.amount ? `$${summary.amount}` : ""} ${detail}${named} (HTTP ${summary.httpStatus ?? "-"}, debug ${summary.debugId ?? "-"})`;
}

type Extra = { create_time?: string; supplementary_data?: { related_ids?: { order_id?: string } } };

function orderIdFrom(auth: PayPalAuthorization, state: State): string | undefined {
  const fromAuth = (auth as Extra).supplementary_data?.related_ids?.order_id;
  if (fromAuth) return fromAuth;
  if (existsSync(S05_STATE_FILE)) {
    const s05 = JSON.parse(readFileSync(S05_STATE_FILE, "utf8")) as { orderId?: string; authorizationId?: string };
    if (s05.authorizationId === state.originalId) return s05.orderId;
  }
  return undefined;
}

async function readAuth(client: PayPalClient, id: string): Promise<{ check: AuthCheck; data?: PayPalAuthorization }> {
  const result = await client.getAuthorization(id);
  if (result.outcome !== "succeeded") return { check: { id, outcome: result.outcome } };
  const data = result.data;
  return {
    data,
    check: { id, outcome: "succeeded", status: data.status, amount: data.amount?.value, createTime: (data as Extra).create_time, expiresAt: data.expiration_time },
  };
}

/** Reads both authorizations and the order's captures. Prints only IDs, statuses and amounts. */
async function check(client: PayPalClient, state: State): Promise<Check> {
  const record: Check = { at: new Date().toISOString() };
  const original = await readAuth(client, state.originalId);
  record.original = original.check;
  if (original.data) {
    state.orderId ??= orderIdFrom(original.data, state);
    state.originalCreateTime ??= original.check.createTime;
    state.originalExpiresAt ??= original.check.expiresAt;
  }
  if (state.newAuthorizationId) record.current = (await readAuth(client, state.newAuthorizationId)).check;

  if (state.orderId) {
    const order = await client.getOrder(state.orderId);
    if (order.outcome === "succeeded") {
      const captures = order.data.purchase_units?.[0]?.payments?.captures ?? [];
      record.orderStatus = order.data.status;
      record.captureCount = captures.length;
      record.capturedCents = captures
        .filter((capture) => capture.status === "COMPLETED" || capture.status === "PENDING")
        .reduce((sum, capture) => sum + toCents(capture.amount?.value), 0);
      record.remainingCents = remainingCents(original.check.amount, captures);
    } else {
      console.log(`  getOrder: ${order.outcome}`);
    }
  }
  state.checks.push(record);
  saveState(state);

  for (const auth of [record.original, record.current]) {
    if (!auth) continue;
    console.log(`  authorization ${auth.id}: ${auth.status ?? auth.outcome} $${auth.amount ?? "?"}, created ${auth.createTime ?? "?"}, expires ${auth.expiresAt ?? "?"}`);
  }
  console.log(
    `  order ${state.orderId ?? "?"}: ${record.orderStatus ?? "?"}, ${record.captureCount ?? "?"} captures, ` +
      `${record.capturedCents === undefined ? "?" : dollars(record.capturedCents)} captured, ` +
      `${record.remainingCents === undefined ? "?" : dollars(record.remainingCents)} uncaptured on the original`,
  );
  if (state.originalCreateTime) {
    const honorEnd = honorEndsAt(state.originalCreateTime);
    const hoursLeft = hoursBetween(new Date(), honorEnd);
    console.log(`  honor period ends ${honorEnd.toISOString()} (${hoursLeft > 0 ? `${hoursLeft} h from now` : "passed"})`);
  }
  return record;
}

async function reauthorize(client: PayPalClient, state: State, flags: Flags) {
  if (state.newAuthorizationId) throw new Error(`Already reauthorized as ${state.newAuthorizationId}. Use "replay".`);
  const before = await check(client, state);
  const attempt = flags.attempt ?? state.attempts.length + 1;
  const amount = flags.amount ?? (before.remainingCents === undefined ? undefined : centsToValue(before.remainingCents));
  if (!amount) throw new Error("Could not work out the uncaptured amount. Pass --amount.");
  const requestId = reauthRequestId(state.originalId, attempt);

  console.log(`Reauthorizing ${state.originalId} for $${amount} (attempt ${attempt}, request ID ${requestId}).`);
  const result = summarizeAuthorization(
    await client.reauthorizeAuthorization({ authorizationId: state.originalId, requestId, amount: { currencyCode: "USD", value: amount } }),
  );
  const issue = lastIssue(result.outcome);
  const at = new Date();
  state.attempts.push({
    attempt,
    at: at.toISOString(),
    hoursSinceCreate: state.originalCreateTime ? hoursBetween(new Date(state.originalCreateTime), at) : undefined,
    requestId,
    sentAmount: amount,
    result,
    issue,
  });
  if (result.outcome === "succeeded" && result.authorizationId) state.newAuthorizationId = result.authorizationId;
  saveState(state);
  console.log(`  -> ${describe(result, issue)}`);
  if (issue?.description) console.log(`  PayPal says: ${issue.description}`);

  if (result.outcome === "succeeded") {
    const sameExpiry = result.expiresAt === state.originalExpiresAt;
    console.log(`  new expiry ${result.expiresAt ?? "?"} (${sameExpiry ? "same as" : "differs from"} the original ${state.originalExpiresAt ?? "?"})`);
  } else if (state.originalCreateTime) {
    console.log(`  Retry after ${honorEndsAt(state.originalCreateTime).toISOString()} with --attempt ${attempt + 1}, or "replay" to test the same ID.`);
  }
  console.log("After reauthorizing:");
  await check(client, state);
}

async function replay(client: PayPalClient, state: State) {
  const first = state.attempts.at(-1);
  if (!first) throw new Error('Nothing to replay. Run "reauthorize" first.');
  console.log(`Replaying attempt ${first.attempt} (request ID ${first.requestId}, $${first.sentAmount}).`);
  const result = summarizeAuthorization(
    await client.reauthorizeAuthorization({
      authorizationId: state.originalId,
      requestId: first.requestId,
      amount: { currencyCode: "USD", value: first.sentAmount },
    }),
  );
  const issue = lastIssue(result.outcome);
  let verdict: Replay["verdict"];
  if (first.result.outcome === "succeeded" && first.result.authorizationId) {
    verdict = compareReauthReplay(first.result.authorizationId, result);
  } else {
    const sameIssue = issue?.issue === first.issue?.issue && result.httpStatus === first.result.httpStatus;
    verdict = result.outcome === "succeeded" ? compareReauthReplay("", result) : sameIssue ? "same_refusal" : "different_refusal";
    if (result.outcome === "succeeded" && result.authorizationId) state.newAuthorizationId = result.authorizationId;
  }
  state.replays.push({ at: new Date().toISOString(), requestId: first.requestId, sentAmount: first.sentAmount, result, issue, verdict });
  saveState(state);
  console.log(`  -> ${verdict}: ${describe(result, issue)}`);
  console.log("After replaying:");
  await check(client, state);
}

async function captureOn(client: PayPalClient, state: State, on: Capture["on"], authorizationId: string, amount: string) {
  const n = state.captures.filter((c) => c.authorizationId === authorizationId).length + 1;
  const requestId = captureRequestId(authorizationId, n);
  const result = summarizeCapture(
    await client.captureAuthorization({
      authorizationId,
      requestId,
      amount: { currencyCode: "USD", value: amount },
      invoiceId: `s06b-${authorizationId}-cap-${n}`,
      finalCapture: false,
    }),
  );
  const issue = lastIssue(result.outcome);
  state.captures.push({ at: new Date().toISOString(), on, authorizationId, requestId, requestedAmount: amount, result, issue });
  saveState(state);
  console.log(`  ${on} ${authorizationId} $${amount} -> ${describe(result, issue)}`);
}

async function capture(client: PayPalClient, state: State) {
  if (!state.newAuthorizationId) throw new Error('No new authorization yet. Run "reauthorize" first.');
  console.log("Capturing on the new authorization, then probing the original:");
  await captureOn(client, state, "new", state.newAuthorizationId, NEW_AUTH_CAPTURE);
  await captureOn(client, state, "original", state.originalId, ORIGINAL_PROBE_CAPTURE);
  console.log("After capturing:");
  await check(client, state);
}

async function voidOn(client: PayPalClient, state: State, on: VoidRecord["on"], authorizationId: string, isReplay: boolean) {
  const requestId = voidRequestId(authorizationId);
  const raw = await client.voidAuthorization({ authorizationId, requestId });
  const result: CallSummary =
    raw.outcome === "succeeded"
      ? { outcome: raw.outcome, status: raw.data.authorization?.status ?? "(no body)", httpStatus: raw.httpStatus, debugId: raw.debugId }
      : raw.outcome === "unknown"
        ? { outcome: raw.outcome, reason: raw.reason, httpStatus: raw.httpStatus, debugId: raw.debugId }
        : { outcome: raw.outcome, code: raw.code, message: raw.message, httpStatus: raw.httpStatus, debugId: raw.debugId };
  const issue = lastIssue(result.outcome);
  state.voids.push({ at: new Date().toISOString(), on, authorizationId, requestId, replay: isReplay, result, issue });
  saveState(state);
  console.log(`  ${isReplay ? "replay " : ""}void ${on} ${authorizationId} -> ${describe(result, issue)}`);
}

async function voidRemainder(client: PayPalClient, state: State) {
  // Without a new authorization the original is still needed for a later retry.
  if (!state.newAuthorizationId) throw new Error("No new authorization yet. Not voiding the original: a later retry needs it.");
  console.log("Voiding the new authorization's remainder, then replaying the void:");
  await voidOn(client, state, "new", state.newAuthorizationId, false);
  await voidOn(client, state, "new", state.newAuthorizationId, true);
  const after = await check(client, state);
  const originalStatus = after.original?.status;
  if (originalStatus && !["VOIDED", "CAPTURED", "EXPIRED", "DENIED"].includes(originalStatus)) {
    console.log(`Original is still ${originalStatus}, so voiding it too:`);
    await voidOn(client, state, "original", state.originalId, false);
    await check(client, state);
  }
}

async function status(client: PayPalClient, state: State) {
  console.log(`Original ${state.originalId}, new ${state.newAuthorizationId ?? "-"}, order ${state.orderId ?? "?"}`);
  for (const a of state.attempts) console.log(`  attempt ${a.attempt} at ${a.at} (+${a.hoursSinceCreate ?? "?"} h): ${describe(a.result, a.issue)}`);
  for (const r of state.replays) console.log(`  replay at ${r.at}: ${r.verdict} ${describe(r.result, r.issue)}`);
  for (const c of state.captures) console.log(`  capture ${c.on} $${c.requestedAmount}: ${describe(c.result, c.issue)}`);
  for (const v of state.voids) console.log(`  ${v.replay ? "replay " : ""}void ${v.on}: ${describe(v.result, v.issue)}`);
  await check(client, state);
}

type Flags = { attempt?: number; amount?: string };

function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--attempt") flags.attempt = Number(args[++i]);
    else if (arg === "--amount") flags.amount = args[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (flags.attempt !== undefined && (!Number.isInteger(flags.attempt) || flags.attempt < 1)) throw new Error("--attempt must be a whole number from 1.");
  if (flags.amount !== undefined && !/^\d+\.\d{2}$/.test(flags.amount)) throw new Error("--amount must look like 51.00.");
  return flags;
}

async function main() {
  const [authorizationId, command, ...rest] = process.argv.slice(2);
  if (!authorizationId || !command) throw new Error("Usage: <authorization-id> check | reauthorize [--attempt N] [--amount X] | replay | capture | void | status");
  const flags = parseFlags(rest);
  mkdirSync(LOG_DIR, { recursive: true });
  const client = makeClient();
  const state = loadState(authorizationId);
  switch (command) {
    case "check":
      return void (await check(client, state));
    case "reauthorize":
      return reauthorize(client, state, flags);
    case "replay":
      return replay(client, state);
    case "capture":
      return capture(client, state);
    case "void":
      return voidRemainder(client, state);
    case "status":
      return status(client, state);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
