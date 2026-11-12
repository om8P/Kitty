/**
 * S40 gate: the milestone 3 scenarios against the real PayPal sandbox, the
 * live Groq reviewer and the Docker Postgres, through the app's own wiring
 * (`getContainer`). Run in two parts, so the owner's approval sits between:
 *
 *   npx tsx scripts/gate/s40-scenarios.ts create   # prints the PayPal approval link
 *   npx tsx scripts/gate/s40-scenarios.ts run      # after the owner approves
 *
 * It reads `.env` itself and never prints a secret. The household and pool it
 * made are kept in the gitignored `.spike-logs/S40/state.json`, and PayPal's
 * raw, redacted exchanges for the integrity read go to `.spike-logs/S40/`.
 * The catalog is the seeded one (`CATALOG_PROVIDER=seeded`), so no Channel3
 * credit is spent. About seven AI reviews run, paced under Groq's free limits.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeMember } from "../../src/domain/members";
import { closePool, confirmPool, createDemoHousehold, createPool } from "../../src/domain/pools";
import { denyPurchase, submitPurchase } from "../../src/domain/purchases";
import type { MemberRow, PoolRow, PurchaseRow } from "../../src/domain/types";
import { getContainer, type Container } from "../../src/server/container";
import { makeClient } from "../spike/spike-env";
import { compareIntegrity, offGoalPassed, ruleBreakerPassed } from "./s40-helpers";

const LOG_DIR = join(".spike-logs", "S40");
const STATE_FILE = join(LOG_DIR, "state.json");
/** Groq's free plan allows 8,000 tokens a minute, and one review uses about 1,000 to 2,500 (S10, M4). */
const REVIEW_PACE_MS = 15_000;

type State = { householdId: string; ownerId: string; teenId: string; poolId: string; orderId: string };

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.CATALOG_PROVIDER = "seeded";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function create(c: Container) {
  const household = await createDemoHousehold(c.db);
  const { pool, approvalUrl } = await createPool(
    { db: c.db, rail: c.rail },
    {
      householdId: household.householdId,
      ownerUserId: household.owner.id,
      goal: "Weekly groceries",
      amountCents: 40_00,
      termDays: 7,
      members: [
        {
          kind: "person",
          userId: household.teen.id,
          label: "Sam",
          limitCents: 40_00,
          approvalThresholdCents: 40_00,
          allowedStores: ["Fresh Market", "Corner Pharmacy", "Style Street", "Gadget Hub"],
        },
        {
          kind: "agent",
          userId: null,
          label: "Shopping agent",
          limitCents: 40_00,
          approvalThresholdCents: 40_00,
          allowedStores: ["Fresh Market"],
        },
      ],
    },
    // The script confirms the pool itself, so these pages only need to exist for PayPal.
    { returnUrl: "http://localhost:3000/", cancelUrl: "http://localhost:3000/" },
  );
  mkdirSync(LOG_DIR, { recursive: true });
  const state: State = {
    householdId: household.householdId,
    ownerId: household.owner.id,
    teenId: household.teen.id,
    poolId: pool.id,
    orderId: pool.paypal_order_id as string,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`Pool created: "Weekly groceries", ${usd(40_00)}, waiting for the owner.`);
  console.log(`Approve it at PayPal as the sandbox buyer:\n  ${approvalUrl}`);
  console.log('Then run: npx tsx scripts/gate/s40-scenarios.ts run');
}

async function aiRequestsToday(c: Container): Promise<number> {
  const [row] = await c.db.query<{ n: number }>(
    "SELECT COALESCE(SUM(count), 0)::int AS n FROM usage_counters WHERE kind = 'ai_request' AND period = $1",
    [new Date().toISOString().slice(0, 10)],
  );
  return row.n;
}

async function run(c: Container) {
  if (!existsSync(STATE_FILE)) throw new Error('No pool yet. Run "create" first.');
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  const purchaseDeps = c.purchases;
  await c.catalog.featured(); // stores the seeded products

  const pool = await confirmPool({ db: c.db, rail: c.rail }, { orderId: state.orderId, householdId: state.householdId });
  if (pool.status !== "active") throw new Error(`The pool is ${pool.status}, not active. Was it approved at PayPal?`);
  console.log(`Pool active: ${usd(pool.authorized_cents)} held at PayPal.`);

  const members = await c.db.query<MemberRow>("SELECT * FROM pool_members WHERE pool_id = $1 ORDER BY position", [
    pool.id,
  ]);
  const sam = members.find((member) => member.kind === "person");
  const agent = members.find((member) => member.kind === "agent");
  if (!sam || !agent) throw new Error("The pool's members are missing.");

  const buy = (memberId: string, slug: string, quantity = 1, key = `s40-${crypto.randomUUID()}`) =>
    submitPurchase(purchaseDeps, { poolId: pool.id, memberId, productId: `seed-${slug}`, quantity, idempotencyKey: key });

  let failures = 0;
  const report = (ok: boolean, line: string) => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${line}`);
  };

  // 1. Replay: the same request twice charges once.
  console.log("\n1. Replay");
  const key = `s40-replay-${crypto.randomUUID()}`;
  const first = await buy(sam.id, "milk", 1, key);
  const second = await buy(sam.id, "milk", 1, key);
  const sameKeyRows = await c.db.query<PurchaseRow>("SELECT * FROM purchases WHERE idempotency_key = $1", [key]);
  report(
    first.status === "captured" && second.id === first.id && sameKeyRows.length === 1,
    `milk ${usd(first.amount_cents)} sent twice with one key: ${sameKeyRows.length} purchase, status ${first.status}, AI ${first.ai_decision}`,
  );

  // 2. Rule breakers: stopped before any AI call.
  console.log("\n2. Rule breakers");
  const aiBefore = await aiRequestsToday(c);
  const breakers: { label: string; expected: string; attempt: () => Promise<PurchaseRow> }[] = [
    { label: "Sam, LED bulbs from Home & Garden", expected: "store_not_allowed", attempt: () => buy(sam.id, "led-bulbs") },
    { label: "Sam, $59.99 headphones", expected: "over_member_limit", attempt: () => buy(sam.id, "headphones") },
    { label: "agent, 7 boxes of cereal ($37.03)", expected: "over_pool_balance", attempt: () => buy(agent.id, "cereal", 7) },
    {
      label: "agent after the owner removed it, milk",
      expected: "member_inactive",
      attempt: async () => {
        await removeMember(c.db, { poolId: pool.id, memberId: agent.id, userId: state.ownerId });
        return buy(agent.id, "milk");
      },
    },
  ];
  for (const breaker of breakers) {
    const result = await breaker.attempt();
    report(
      ruleBreakerPassed({ status: result.status, ruleCode: result.rule_code, aiDecision: result.ai_decision }, breaker.expected),
      `${breaker.label}: ${result.status} (${result.rule_code ?? "no rule"}), AI ${result.ai_decision ?? "not called"}`,
    );
  }
  const aiAfter = await aiRequestsToday(c);
  report(aiAfter === aiBefore, `AI requests during the rule breakers: ${aiAfter - aiBefore}`);

  // 3. Off-goal purchases within Sam's rules, against the live reviewer.
  console.log("\n3. Off-goal spot check (live Groq)");
  const offGoal = ["game-gift-card", "mystery-figure", "energy-drinks", "hoodie", "gaming-mouse", "phone-charger"];
  const waiting: string[] = [];
  for (const [index, slug] of offGoal.entries()) {
    if (index > 0) await sleep(REVIEW_PACE_MS);
    const result = await buy(sam.id, slug);
    if (result.status === "awaiting_approval") waiting.push(result.id);
    report(
      offGoalPassed(result.status, result.ai_decision),
      `${result.product_title} ${usd(result.amount_cents)}: ${result.status}, AI ${result.ai_decision}. ${result.ai_reason ?? ""}`,
    );
  }
  // Deny the flagged ones, as the owner would, so nothing is left waiting.
  for (const id of waiting) await denyPurchase(purchaseDeps, { purchaseId: id, userId: state.ownerId });

  // 4. Pool integrity: Kitty's captured total against PayPal's record.
  console.log("\n4. Pool integrity");
  const [current] = await c.db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [pool.id]);
  const captured = await c.db.query<{ id: string }>(
    "SELECT id FROM purchases WHERE pool_id = $1 AND status IN ('captured', 'refund_pending', 'refunded')",
    [pool.id],
  );
  const { client } = makeClient(LOG_DIR);
  const order = await client.getOrder(state.orderId);
  if (order.outcome !== "succeeded") throw new Error(`Reading the order from PayPal failed: ${order.outcome}`);
  const captures = (order.data.purchase_units?.[0]?.payments?.captures ?? []).map((capture) => ({
    status: capture.status,
    amountValue: capture.amount?.value,
    invoiceId: capture.invoice_id,
  }));
  const integrity = compareIntegrity(current.captured_cents, captured.map((row) => row.id), captures);
  report(
    integrity.match,
    `Kitty captured ${usd(integrity.kittyCapturedCents)} in ${captured.length}, PayPal ${usd(integrity.paypalCapturedCents)} in ${integrity.paypalCaptureCount}, unmatched ${integrity.unmatched}`,
  );
  report(current.captured_cents + current.reserved_cents <= current.authorized_cents, `pool not overspent: reserved ${usd(current.reserved_cents)}, captured ${usd(current.captured_cents)} of ${usd(current.authorized_cents)}`);

  // 5. Close the pool, so PayPal releases the rest of the hold.
  console.log("\n5. Close");
  const closed = await closePool({ db: c.db, rail: c.rail }, { poolId: pool.id, userId: state.ownerId });
  console.log(`Pool ${closed.status}, released ${usd(closed.released_cents)}.`);

  console.log(`\n${failures === 0 ? "All scenarios passed." : `${failures} check(s) failed.`}`);
  if (failures) process.exitCode = 1;
}

async function main() {
  const command = process.argv[2];
  if (command !== "create" && command !== "run") throw new Error("Usage: s40-scenarios.ts create | run");
  const container = await getContainer();
  if (container.rail.name === "unconfigured") throw new Error("PayPal isn't set up in .env.");
  if (command === "create") await create(container);
  else await run(container);
}

main()
  .catch((error: unknown) => {
    console.error("S40 stopped:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 100));
