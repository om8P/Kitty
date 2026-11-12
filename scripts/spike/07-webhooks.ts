/**
 * S07 spike: read the webhooks the receiver saved, verify their signatures
 * with PayPal, and total an authorization's captures with read calls.
 * Answers architecture Q7 and part of Q5. Sandbox only.
 *
 *   npx tsx scripts/spike/07-webhooks.ts summary              one line per saved delivery
 *   npx tsx scripts/spike/07-webhooks.ts verify [file|--all]  verify the latest (or each) delivery
 *   npx tsx scripts/spike/07-webhooks.ts total <authorizationId>
 *
 * Reads credentials and PAYPAL_WEBHOOK_ID from .env itself and never prints
 * them. Raw exchanges go to the gitignored .spike-logs/S07/ folder.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { headerSource, linkedId, parseDelivery, summarizeEvent, type EventSummary } from "./s07-helpers";
import { dollars, makeClient, toCents } from "./spike-env";

const LOG_DIR = join(".spike-logs", "S07");
const DIR = join(LOG_DIR, "deliveries");
const RESULTS = join(LOG_DIR, "verifications.json");

function deliveryFiles(): string[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(DIR, name));
}

function line(file: string, event: EventSummary | undefined): string {
  if (!event) return `${basename(file)}: not a PayPal event`;
  const parts = [
    event.createTime,
    event.eventType,
    `${event.resourceType ?? "?"} ${event.resourceId ?? "?"}`,
    event.status,
    event.amount ? `$${event.amount}` : undefined,
    `invoice_id=${event.invoiceId ?? "-"}`,
    event.captureId && event.captureId !== event.resourceId ? `capture=${event.captureId}` : undefined,
    `auth=${event.authorizationId ?? "-"}`,
    `order=${event.orderId ?? "-"}`,
  ];
  return parts.filter(Boolean).join("  ");
}

function summary() {
  const files = deliveryFiles();
  if (files.length === 0) console.log(`No deliveries in ${DIR} yet.`);
  const counts = new Map<string, number>();
  for (const file of files) {
    const delivery = parseDelivery(readFileSync(file, "utf8"));
    const event = delivery ? summarizeEvent(delivery.rawBody) : undefined;
    console.log(line(file, event));
    const type = event?.eventType ?? "(unreadable)";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (files.length > 0) {
    console.log("\nBy type:");
    for (const [type, n] of [...counts].sort()) console.log(`  ${n}x ${type}`);
  }
}

async function verify(target: string | undefined) {
  const files = deliveryFiles();
  const chosen = target === "--all" ? files : target ? [target] : files.slice(-1);
  if (chosen.length === 0) throw new Error(`No deliveries in ${DIR} yet.`);
  const { client } = makeClient(LOG_DIR);
  if (!process.env.PAYPAL_WEBHOOK_ID) throw new Error("PAYPAL_WEBHOOK_ID is not set in .env.");
  const results: { file: string; eventType?: string; eventId?: string; outcome: string; code?: string }[] = [];
  for (const file of chosen) {
    const delivery = parseDelivery(readFileSync(file, "utf8"));
    if (!delivery) {
      console.log(`${basename(file)}: unreadable`);
      continue;
    }
    const event = summarizeEvent(delivery.rawBody);
    const result = await client.verifyWebhookSignature({ rawBody: delivery.rawBody, headers: headerSource(delivery.headers) });
    const code = result.outcome === "failed" ? result.code : result.outcome === "unknown" ? result.reason : undefined;
    results.push({ file: basename(file), eventType: event?.eventType, eventId: event?.eventId, outcome: result.outcome, code });
    console.log(`${basename(file)} ${event?.eventType ?? ""}: ${result.outcome}${code ? ` (${code})` : ""}`);
  }
  writeFileSync(RESULTS, `${JSON.stringify(results, null, 2)}\n`);
}

async function total(authorizationId: string | undefined) {
  if (!authorizationId) throw new Error("Usage: total <authorizationId>");
  const { client } = makeClient(LOG_DIR);
  const auth = await client.getAuthorization(authorizationId);
  if (auth.outcome !== "succeeded") throw new Error(`getAuthorization: ${auth.outcome}`);
  const orderId = linkedId(auth.data.links, "up", "orders");
  console.log(`Authorization ${authorizationId}: ${auth.data.status}, $${auth.data.amount?.value ?? "?"}, order ${orderId ?? "?"}`);
  if (!orderId) throw new Error("The authorization has no link to its order.");
  const order = await client.getOrder(orderId);
  if (order.outcome !== "succeeded") throw new Error(`getOrder: ${order.outcome}`);
  const captures = order.data.purchase_units?.[0]?.payments?.captures ?? [];
  let completed = 0;
  for (const c of captures) {
    console.log(`  capture ${c.id} $${c.amount?.value ?? "?"} ${c.status} invoice_id=${c.invoice_id ?? "-"}`);
    if (c.status === "COMPLETED" || c.status === "PARTIALLY_REFUNDED" || c.status === "REFUNDED") completed += toCents(c.amount?.value);
  }
  console.log(`  ${captures.length} captures, ${dollars(completed)} captured (refunds not subtracted)`);
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case "summary":
      return summary();
    case "verify":
      return verify(arg);
    case "total":
      return total(arg);
    default:
      throw new Error("Usage: summary | verify [file|--all] | total <authorizationId>");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
