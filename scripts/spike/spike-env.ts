/**
 * Shared setup for the PayPal sandbox spikes: a logging client built from
 * .env, and small money and timing helpers. Credentials are read here and
 * never printed. Raw, redacted exchanges go to the given log folder.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createPayPalClient, type PayPalClient } from "../../src/adapters/payments/paypal-client";
import { createLoggingFetch, type LogEntry } from "./s05-helpers";

export type SpikeClient = {
  client: PayPalClient;
  /** The most recent logged exchange, for reading PayPal's exact error codes. */
  lastEntry: () => LogEntry | undefined;
};

export function makeClient(logDir: string): SpikeClient {
  try {
    process.loadEnvFile(".env");
  } catch {
    throw new Error("Could not load .env. Create it from .env.example (plan step S02).");
  }
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in .env.");

  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  let last: LogEntry | undefined;
  const loggingFetch = createLoggingFetch(fetch, (entry) => {
    last = entry;
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  });
  const client = createPayPalClient({
    clientId,
    clientSecret,
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
    fetch: loggingFetch,
  });
  return { client, lastEntry: () => last };
}

export function toCents(value: string | undefined): number {
  return value === undefined ? 0 : Math.round(Number(value) * 100);
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const APPROVAL_POLL_MS = 5_000;
const APPROVAL_WAIT_MS = 15 * 60_000;

/** Polls the order until the buyer approves it. Throws on timeout or if the order ends first. */
export async function waitForApproval(client: PayPalClient, orderId: string): Promise<void> {
  const deadline = Date.now() + APPROVAL_WAIT_MS;
  let lastStatus = "";
  console.log(`Waiting up to ${APPROVAL_WAIT_MS / 60_000} minutes for approval...`);
  while (true) {
    const order = await client.getOrder(orderId);
    const status = order.outcome === "succeeded" ? order.data.status : `(${order.outcome})`;
    if (status !== lastStatus) {
      console.log(`  ${new Date().toISOString()} order status: ${status}`);
      lastStatus = status;
    }
    if (status === "APPROVED") return;
    if (status === "VOIDED" || status === "COMPLETED") throw new Error(`Order ended as ${status} before authorization.`);
    if (Date.now() > deadline) throw new Error('Timed out waiting for approval. Approve, then run "authorize".');
    await sleep(APPROVAL_POLL_MS);
  }
}
