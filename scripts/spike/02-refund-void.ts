/**
 * S06a spike: refund a capture, test whether the refund gives the
 * authorization capacity back, then void the remainder. Every write is
 * replayed with the same PayPal-Request-Id. Answers architecture Q6, the void
 * part of Q4 and the refund and void parts of Q5. Sandbox only.
 *
 *   npx tsx scripts/spike/02-refund-void.ts start [--new]   create a $100 order, wait for approval, authorize
 *   npx tsx scripts/spike/02-refund-void.ts authorize       resume waiting for approval on the saved order
 *   npx tsx scripts/spike/02-refund-void.ts capture         captures #1 to #3 ($20, $30, $40)
 *   npx tsx scripts/spike/02-refund-void.ts probe --label control|after-refund|small
 *   npx tsx scripts/spike/02-refund-void.ts refund          refund capture #3
 *   npx tsx scripts/spike/02-refund-void.ts refund-replay   same request ID, then a new one on the same capture
 *   npx tsx scripts/spike/02-refund-void.ts void            void the remainder
 *   npx tsx scripts/spike/02-refund-void.ts void-replay     same request ID, then a capture on the voided authorization
 *   npx tsx scripts/spike/02-refund-void.ts refund-after-void   refund capture #1 after the void
 *   npx tsx scripts/spike/02-refund-void.ts status          read-only
 *
 * Suggested order: start, capture, probe --label control, refund,
 * probe --label after-refund, probe --label small, refund-replay, void,
 * void-replay, refund-after-void, status.
 *
 * Reads credentials from .env itself and never prints them. Raw, redacted
 * exchanges and saved IDs go to the gitignored .spike-logs/S06a/ folder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PayPalResult } from "../../src/adapters/payments/paypal-client";
import { summarizeCapture, type CallSummary } from "./s05-helpers";
import {
  CAPTURE_AMOUNTS,
  ORDER_AMOUNT,
  PROBES,
  REFUNDED_CAPTURE,
  REFUND_AFTER_VOID_CAPTURE,
  capacityVerdict,
  captureInvoiceId,
  captureRequestId,
  compareRefundReplay,
  extractIssue,
  isProbeLabel,
  probeRequestId,
  refundRequestId,
  summarizeRefund,
  voidRequestId,
  type Issue,
  type ProbeLabel,
  type RefundSummary,
} from "./s06a-helpers";
import { dollars, makeClient, toCents, waitForApproval, type SpikeClient } from "./spike-env";

const LOG_DIR = join(".spike-logs", "S06a");
const STATE_FILE = join(LOG_DIR, "state.json");

/** Any recorded call: its summary plus PayPal's exact error, when there was one. */
type Call<S> = S & { at: string; label: string; requestId?: string; issue?: Issue };

type Check = {
  at: string;
  label: string;
  authorizationStatus?: string;
  orderStatus?: string;
  captureCount?: number;
  capturedCents?: number;
  refundCount?: number;
  refundedCents?: number;
  captures?: { id: string; status: string; amount?: string }[];
};

type State = {
  runId: string;
  startedAt: string;
  orderId?: string;
  approvalUrl?: string;
  authorizationId?: string;
  authorizationExpiresAt?: string;
  captures: Call<CallSummary & { n: number; requestedAmount: string }>[];
  probes: Call<CallSummary & { probe: ProbeLabel; requestedAmount: string }>[];
  refunds: Call<RefundSummary & { captureId: string; verdict?: string }>[];
  voids: Call<{ outcome: string; status?: string; httpStatus?: number; debugId?: string; code?: string; reason?: string }>[];
  checks: Check[];
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

function captureNumber(state: State, n: number): string {
  const record = state.captures.find((c) => c.n === n && c.outcome === "succeeded");
  if (!record?.captureId) throw new Error(`Capture #${n} has not succeeded yet. Run "capture" first.`);
  return record.captureId;
}

/** PayPal's exact error for the last call, if its response was an error. */
function issueOf(spike: SpikeClient, result: PayPalResult<unknown>): Issue | undefined {
  return result.outcome === "succeeded" ? undefined : extractIssue(spike.lastEntry()?.responseBody);
}

function describe(summary: { outcome: string; status?: string; amount?: string; code?: string; reason?: string; httpStatus?: number }, issue?: Issue) {
  const parts = [summary.outcome, summary.status, summary.amount ? `$${summary.amount}` : undefined, summary.code ?? summary.reason];
  if (issue) parts.push(`[${issue.name ?? "?"}: ${issue.issues.join(", ") || "-"}]`);
  return `${parts.filter(Boolean).join(" ")} (HTTP ${summary.httpStatus ?? "-"})`;
}

/** Reads the authorization, the order's captures and refunds, and each capture. No writes. */
async function check(spike: SpikeClient, state: State, label: string): Promise<Check> {
  const { client } = spike;
  const record: Check = { at: new Date().toISOString(), label };
  if (state.authorizationId) {
    const auth = await client.getAuthorization(state.authorizationId);
    if (auth.outcome === "succeeded") record.authorizationStatus = auth.data.status;
    else console.log(`  getAuthorization: ${auth.outcome}`);
  }
  if (state.orderId) {
    const order = await client.getOrder(state.orderId);
    if (order.outcome === "succeeded") {
      const payments = order.data.purchase_units?.[0]?.payments as
        | { captures?: { id: string; status: string; amount?: { value: string } }[]; refunds?: { status: string; amount?: { value: string } }[] }
        | undefined;
      const captures = payments?.captures ?? [];
      const refunds = payments?.refunds ?? [];
      record.orderStatus = order.data.status;
      record.captureCount = captures.length;
      record.capturedCents = captures.reduce((sum, c) => sum + toCents(c.amount?.value), 0);
      record.refundCount = refunds.length;
      record.refundedCents = refunds.filter((r) => r.status === "COMPLETED").reduce((sum, r) => sum + toCents(r.amount?.value), 0);
      record.captures = captures.map((c) => ({ id: c.id, status: c.status, amount: c.amount?.value }));
    } else {
      console.log(`  getOrder: ${order.outcome}`);
    }
  }
  state.checks.push(record);
  saveState(state);
  console.log(`  authorization ${state.authorizationId ?? "-"}: ${record.authorizationStatus ?? "?"}`);
  console.log(
    `  order ${state.orderId ?? "-"}: ${record.orderStatus ?? "?"}, ${record.captureCount ?? "?"} captures` +
      ` (${record.capturedCents === undefined ? "?" : dollars(record.capturedCents)}),` +
      ` ${record.refundCount ?? "?"} refunds (${record.refundedCents === undefined ? "?" : dollars(record.refundedCents)})`,
  );
  for (const c of record.captures ?? []) console.log(`    capture ${c.id} $${c.amount ?? "?"} ${c.status}`);
  return record;
}

async function start(spike: SpikeClient, flags: Flags) {
  const existing = loadState();
  if (existing?.authorizationId && !flags.new) {
    throw new Error(`Authorization ${existing.authorizationId} is already saved. Pass --new to start a fresh run.`);
  }
  const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const state: State = { runId, startedAt: new Date().toISOString(), captures: [], probes: [], refunds: [], voids: [], checks: [] };
  const created = await spike.client.createOrder({
    requestId: `s06a-order-${runId}`,
    amount: { currencyCode: "USD", value: ORDER_AMOUNT },
    returnUrl: "https://example.com/kitty-spike/return",
    cancelUrl: "https://example.com/kitty-spike/cancel",
    invoiceId: captureInvoiceId(runId, "order"),
  });
  if (created.outcome !== "succeeded") {
    throw new Error(`createOrder ${created.outcome}: ${created.outcome === "unknown" ? created.reason : `${created.code} ${created.message}`}`);
  }
  state.orderId = created.data.order.id;
  state.approvalUrl = created.data.approvalUrl;
  saveState(state);
  console.log(`Order ${state.orderId} created for $${ORDER_AMOUNT} (status ${created.data.order.status}).`);
  console.log("\nApprove it with the US sandbox buyer account:\n");
  console.log(`  ${state.approvalUrl}\n`);
  await authorize(spike, state);
}

async function authorize(spike: SpikeClient, state: State) {
  if (!state.orderId) throw new Error("No order saved.");
  if (state.authorizationId) {
    console.log(`Already authorized: ${state.authorizationId}`);
    return;
  }
  await waitForApproval(spike.client, state.orderId);
  const authorized = await spike.client.authorizeOrder({ orderId: state.orderId, requestId: `s06a-authorize-${state.runId}` });
  if (authorized.outcome !== "succeeded") {
    throw new Error(`authorizeOrder ${authorized.outcome}: ${JSON.stringify(issueOf(spike, authorized) ?? {})}`);
  }
  const auth = authorized.data.authorization;
  state.authorizationId = auth.id;
  state.authorizationExpiresAt = auth.expiration_time;
  saveState(state);
  console.log(`\nAuthorization ${auth.id}: ${auth.status}, $${auth.amount?.value ?? "?"}, expires ${auth.expiration_time ?? "?"}`);
}

async function captureOnce(spike: SpikeClient, state: State, requestId: string, amount: string, invoiceLabel: string) {
  const result = await spike.client.captureAuthorization({
    authorizationId: requireAuthorization(state),
    requestId,
    amount: { currencyCode: "USD", value: amount },
    invoiceId: captureInvoiceId(state.runId, invoiceLabel),
    finalCapture: false,
  });
  return { summary: summarizeCapture(result), issue: issueOf(spike, result) };
}

async function capture(spike: SpikeClient, state: State) {
  const authorizationId = requireAuthorization(state);
  for (let n = 1; n <= CAPTURE_AMOUNTS.length; n++) {
    if (state.captures.some((c) => c.n === n && c.outcome === "succeeded")) continue;
    const requestedAmount = CAPTURE_AMOUNTS[n - 1];
    const requestId = captureRequestId(authorizationId, n);
    const { summary, issue } = await captureOnce(spike, state, requestId, requestedAmount, `cap-${n}`);
    state.captures.push({ ...summary, n, requestedAmount, at: new Date().toISOString(), label: `capture-${n}`, requestId, issue });
    saveState(state);
    console.log(`  #${n} $${requestedAmount} -> ${summary.captureId ?? ""} ${describe(summary, issue)}`);
    if (summary.outcome !== "succeeded") throw new Error(`Capture #${n} did not succeed. Stopping.`);
  }
  await check(spike, state, "after-captures");
}

async function probe(spike: SpikeClient, state: State, label: ProbeLabel) {
  const authorizationId = requireAuthorization(state);
  if (label === "after-refund" && !state.refunds.some((r) => r.label === "refund" && r.outcome === "succeeded")) {
    throw new Error('Run "refund" before the after-refund probe.');
  }
  if (label !== "control" && !state.probes.some((p) => p.probe === "control")) {
    throw new Error('Run "probe --label control" first.');
  }
  const requestedAmount = PROBES[label];
  const requestId = probeRequestId(authorizationId, label);
  const { summary, issue } = await captureOnce(spike, state, requestId, requestedAmount, `probe-${label}`);
  state.probes.push({ ...summary, probe: label, requestedAmount, at: new Date().toISOString(), label: `probe-${label}`, requestId, issue });
  saveState(state);
  console.log(`  probe ${label} $${requestedAmount} -> ${summary.captureId ?? ""} ${describe(summary, issue)}`);
  if (issue?.description) console.log(`    PayPal says: ${issue.description}`);

  const control = state.probes.find((p) => p.probe === "control");
  const after = state.probes.find((p) => p.probe === "after-refund");
  if (control && after) console.log(`  Capacity verdict (Q6): ${capacityVerdict(control, after)}`);
  else if (label === "control" && summary.outcome !== "failed") {
    console.log("  WARNING: the control capture was not refused, so the capacity test is inconclusive.");
  }
  await check(spike, state, `after-probe-${label}`);
}

async function refundOnce(spike: SpikeClient, state: State, captureId: string, requestId: string, label: string) {
  const result = await spike.client.refundCapture({ captureId, requestId });
  const summary = summarizeRefund(result);
  const issue = issueOf(spike, result);
  const record: State["refunds"][number] = { ...summary, captureId, at: new Date().toISOString(), label, requestId, issue };
  state.refunds.push(record);
  saveState(state);
  console.log(`  ${label} on ${captureId} -> ${summary.refundId ?? ""} ${describe(summary, issue)}`);
  if (issue?.description) console.log(`    PayPal says: ${issue.description}`);
  return record;
}

async function readCapture(spike: SpikeClient, captureId: string) {
  const stored = await spike.client.getCapture(captureId);
  if (stored.outcome === "succeeded") console.log(`  stored capture ${captureId}: ${stored.data.status} $${stored.data.amount?.value ?? "?"}`);
  else console.log(`  getCapture ${captureId}: ${stored.outcome}`);
}

async function refund(spike: SpikeClient, state: State) {
  const captureId = captureNumber(state, REFUNDED_CAPTURE);
  if (state.refunds.some((r) => r.label === "refund" && r.outcome === "succeeded")) {
    throw new Error('Capture #3 is already refunded. Use "refund-replay" to replay it.');
  }
  await refundOnce(spike, state, captureId, refundRequestId(captureId), "refund");
  await readCapture(spike, captureId);
  await check(spike, state, "after-refund");
}

async function refundReplay(spike: SpikeClient, state: State) {
  const captureId = captureNumber(state, REFUNDED_CAPTURE);
  const original = state.refunds.find((r) => r.label === "refund" && r.outcome === "succeeded");
  if (!original?.refundId) throw new Error('No successful refund to replay. Run "refund" first.');
  const before = await check(spike, state, "before-refund-replay");

  const same = await refundOnce(spike, state, captureId, refundRequestId(captureId), "refund-replay-same-id");
  same.verdict = compareRefundReplay(original.refundId, same);
  const fresh = await refundOnce(spike, state, captureId, refundRequestId(captureId, "again"), "refund-again-new-id");
  fresh.verdict = compareRefundReplay(original.refundId, fresh);
  saveState(state);
  console.log(`  same request ID: ${same.verdict}; new request ID: ${fresh.verdict}`);

  const after = await check(spike, state, "after-refund-replay");
  const moved = after.refundedCents !== before.refundedCents || after.refundCount !== before.refundCount;
  console.log(moved ? "  WARNING: refunded money changed during the replay." : "  No extra money moved.");
}

async function voidOnce(spike: SpikeClient, state: State, label: string) {
  const authorizationId = requireAuthorization(state);
  const requestId = voidRequestId(authorizationId);
  const result = await spike.client.voidAuthorization({ authorizationId, requestId });
  const issue = issueOf(spike, result);
  const record =
    result.outcome === "succeeded"
      ? { outcome: result.outcome, status: result.data.authorization?.status ?? "(no body)", httpStatus: result.httpStatus, debugId: result.debugId }
      : result.outcome === "unknown"
        ? { outcome: result.outcome, reason: result.reason, httpStatus: result.httpStatus, debugId: result.debugId }
        : { outcome: result.outcome, code: result.code, httpStatus: result.httpStatus, debugId: result.debugId };
  state.voids.push({ ...record, at: new Date().toISOString(), label, requestId, issue });
  saveState(state);
  console.log(`  ${label} -> ${describe(record, issue)}`);
  if (issue?.description) console.log(`    PayPal says: ${issue.description}`);
}

async function voidRemainder(spike: SpikeClient, state: State) {
  if (state.voids.some((v) => v.label === "void" && v.outcome === "succeeded")) {
    throw new Error('Already voided. Use "void-replay".');
  }
  await voidOnce(spike, state, "void");
  await check(spike, state, "after-void");
}

async function voidReplay(spike: SpikeClient, state: State) {
  if (!state.voids.some((v) => v.label === "void")) throw new Error('Run "void" first.');
  await voidOnce(spike, state, "void-replay-same-id");
  const authorizationId = requireAuthorization(state);
  const { summary, issue } = await captureOnce(spike, state, `s06a-after-void-${authorizationId}`, "1.00", "after-void");
  state.probes.push({
    ...summary,
    probe: "small",
    requestedAmount: "1.00",
    at: new Date().toISOString(),
    label: "capture-after-void",
    requestId: `s06a-after-void-${authorizationId}`,
    issue,
  });
  saveState(state);
  console.log(`  capture after void $1.00 -> ${summary.captureId ?? ""} ${describe(summary, issue)}`);
  if (issue?.description) console.log(`    PayPal says: ${issue.description}`);
  await check(spike, state, "after-void-replay");
}

async function refundAfterVoid(spike: SpikeClient, state: State) {
  if (!state.voids.some((v) => v.label === "void" && v.outcome === "succeeded")) throw new Error('Run "void" first.');
  const captureId = captureNumber(state, REFUND_AFTER_VOID_CAPTURE);
  await refundOnce(spike, state, captureId, refundRequestId(captureId), "refund-after-void");
  await readCapture(spike, captureId);
  await check(spike, state, "after-refund-after-void");
}

async function status(spike: SpikeClient, state: State) {
  console.log(`Run ${state.runId}, started ${state.startedAt}, authorization expires ${state.authorizationExpiresAt ?? "?"}`);
  for (const c of [...state.captures, ...state.probes]) console.log(`  ${c.label}: ${c.captureId ?? ""} ${describe(c, c.issue)}`);
  for (const r of state.refunds) console.log(`  ${r.label}: ${r.refundId ?? ""} ${describe(r, r.issue)} ${r.verdict ?? ""}`);
  for (const v of state.voids) console.log(`  ${v.label}: ${describe(v, v.issue)}`);
  const control = state.probes.find((p) => p.probe === "control");
  const after = state.probes.find((p) => p.probe === "after-refund");
  if (control && after) console.log(`  Capacity verdict (Q6): ${capacityVerdict(control, after)}`);
  await check(spike, state, "status");
  for (const c of state.captures) if (c.captureId) await readCapture(spike, c.captureId);
}

type Flags = { new?: boolean; label?: string };

function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--new") flags.new = true;
    else if (arg === "--label") flags.label = args[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return flags;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  mkdirSync(LOG_DIR, { recursive: true });
  const spike = makeClient(LOG_DIR);
  switch (command) {
    case "start":
      return start(spike, flags);
    case "authorize":
      return authorize(spike, requireState());
    case "capture":
      return capture(spike, requireState());
    case "probe":
      if (!isProbeLabel(flags.label)) throw new Error(`--label must be one of: ${Object.keys(PROBES).join(", ")}`);
      return probe(spike, requireState(), flags.label);
    case "refund":
      return refund(spike, requireState());
    case "refund-replay":
      return refundReplay(spike, requireState());
    case "void":
      return voidRemainder(spike, requireState());
    case "void-replay":
      return voidReplay(spike, requireState());
    case "refund-after-void":
      return refundAfterVoid(spike, requireState());
    case "status":
      return status(spike, requireState());
    default:
      throw new Error(
        "Usage: start [--new] | authorize | capture | probe --label L | refund | refund-replay | void | void-replay | refund-after-void | status",
      );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
