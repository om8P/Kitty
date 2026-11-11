/** Test helpers: a fresh schema on the test Postgres, a scriptable payment rail and reviewer, and a ready-made pool. */
import { openTestDatabase, type TestDatabaseOptions } from "@/db/testing";
import { confirmPool, createDemoHousehold, createPool, type NewMember } from "./pools";
import type { Database, PaymentRail, RailResult, ReviewFacts, ReviewResult, Reviewer } from "./ports";
import type { PurchaseDeps } from "./purchases";
import { newId, type MemberRow, type PoolRow, type UserRow } from "./types";

export type FakeRail = PaymentRail & {
  charges: { purchaseId: string; amountCents: number }[];
  refunds: string[];
  releases: string[];
  nextCharge: RailResult<{ captureId: string }> | null;
  nextRefund: RailResult<{ refundId: string }> | null;
  nextRelease: RailResult<Record<string, never>> | null;
};

export function createFakeRail(): FakeRail {
  const rail: FakeRail = {
    name: "simulated",
    charges: [],
    refunds: [],
    releases: [],
    nextCharge: null,
    nextRefund: null,
    nextRelease: null,
    async createPoolPayment({ poolId, returnUrl }) {
      return { outcome: "succeeded", data: { orderId: `ORDER-${poolId}`, approvalUrl: `${returnUrl}?token=ORDER-${poolId}` } };
    },
    async confirmPoolPayment({ poolId }) {
      return { outcome: "succeeded", data: { authorizationId: `AUTH-${poolId}`, authorizedCents: null, expiresAt: null } };
    },
    async charge({ purchaseId, amountCents }) {
      rail.charges.push({ purchaseId, amountCents });
      const scripted = rail.nextCharge;
      rail.nextCharge = null;
      return scripted ?? { outcome: "succeeded", data: { captureId: `CAP-${purchaseId}` } };
    },
    async refund({ purchaseId }) {
      rail.refunds.push(purchaseId);
      const scripted = rail.nextRefund;
      rail.nextRefund = null;
      return scripted ?? { outcome: "succeeded", data: { refundId: `REF-${purchaseId}` } };
    },
    async releaseHold({ authorizationId }) {
      rail.releases.push(authorizationId);
      const scripted = rail.nextRelease;
      rail.nextRelease = null;
      return scripted ?? { outcome: "succeeded", data: {} };
    },
  };
  return rail;
}

export type FakeReviewer = Reviewer & { calls: ReviewFacts[]; next: ReviewResult };

export function createFakeReviewer(): FakeReviewer {
  const reviewer: FakeReviewer = {
    calls: [],
    next: { decision: "allow", reason: "Fits the goal." },
    async review(facts) {
      reviewer.calls.push(facts);
      return reviewer.next;
    },
  };
  return reviewer;
}

export type World = {
  db: Database;
  rail: FakeRail;
  reviewer: FakeReviewer;
  deps: PurchaseDeps;
  owner: UserRow;
  teenUser: UserRow;
  householdId: string;
  pool: PoolRow;
  teen: MemberRow;
  agent: MemberRow;
  addProduct(input: { store?: string; priceCents: number; title?: string; description?: string }): Promise<string>;
  reload(): Promise<{ pool: PoolRow; teen: MemberRow; agent: MemberRow }>;
};

/** An active $150 grocery pool: a teen ($40 limit, approval above $15) and an agent ($80 limit, approval above $25). */
export async function createWorld(
  options: {
    amountCents?: number;
    members?: Partial<Record<"teen" | "agent", Partial<NewMember>>>;
    database?: TestDatabaseOptions;
  } = {},
): Promise<World> {
  const db = await openTestDatabase(options.database);
  const rail = createFakeRail();
  const reviewer = createFakeReviewer();
  const household = await createDemoHousehold(db);

  const { pool: created } = await createPool(
    { db, rail },
    {
      householdId: household.householdId,
      ownerUserId: household.owner.id,
      goal: "Weekly groceries",
      amountCents: options.amountCents ?? 150_00,
      termDays: 28,
      members: [
        {
          kind: "person",
          userId: household.teen.id,
          label: "Sam",
          limitCents: 40_00,
          approvalThresholdCents: 15_00,
          allowedStores: ["Fresh Market", "Corner Pharmacy"],
          ...options.members?.teen,
        },
        {
          kind: "agent",
          userId: null,
          label: "Shopping agent",
          limitCents: 80_00,
          approvalThresholdCents: 25_00,
          allowedStores: ["Fresh Market"],
          ...options.members?.agent,
        },
      ],
    },
    { returnUrl: "http://localhost/return", cancelUrl: "http://localhost/cancel" },
  );
  await confirmPool({ db, rail }, { orderId: created.paypal_order_id as string, householdId: household.householdId });

  const reload = async () => {
    const [pool] = await db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [created.id]);
    const members = await db.query<MemberRow>("SELECT * FROM pool_members WHERE pool_id = $1 ORDER BY position", [created.id]);
    return { pool, teen: members[0], agent: members[1] };
  };
  const loaded = await reload();

  return {
    db,
    rail,
    reviewer,
    deps: { db, rail, reviewer },
    owner: household.owner,
    teenUser: household.teen,
    householdId: household.householdId,
    ...loaded,
    reload,
    async addProduct({ store = "Fresh Market", priceCents, title = "Test item", description = "" }) {
      const id = newId();
      await db.query(
        "INSERT INTO products (id, source, external_id, store, title, description, price_cents) VALUES ($1, 'seed', $1, $2, $3, $4, $5)",
        [id, store, title, description, priceCents],
      );
      return id;
    },
  };
}
