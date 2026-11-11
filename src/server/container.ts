import { createCatalog } from "@/adapters/catalog/catalog";
import { createRail } from "@/adapters/payments/rail";
import type { AgentDeps } from "@/ai/agent";
import { createGroqModel, type Model } from "@/ai/model";
import { createReviewer } from "@/ai/reviewer";
import { getDatabase } from "@/db/client";
import type { Catalog, Database, PaymentRail } from "@/domain/ports";
import type { PurchaseDeps } from "@/domain/purchases";

/** Groq's free plan allows 1,000 requests a day. Stop before that so reviews fail safe, not hard. */
const AI_DAILY_CAP = 800;

export type Container = {
  db: Database;
  rail: PaymentRail;
  model: Model;
  catalog: Catalog & { readonly provider: "channel3" | "seed" };
  purchases: PurchaseDeps;
  agent: AgentDeps;
};

const store = globalThis as typeof globalThis & { __kittyContainer?: Promise<Container> };

/** Everything the routes need, wired once per process. */
export function getContainer(): Promise<Container> {
  store.__kittyContainer ??= build().catch((error) => {
    store.__kittyContainer = undefined;
    throw error;
  });
  return store.__kittyContainer;
}

async function build(): Promise<Container> {
  const db = await getDatabase();
  const rail = createRail();
  const model = createGroqModel(process.env, { allow: () => underDailyCap(db) });
  const catalog = createCatalog(db);
  const purchases: PurchaseDeps = { db, rail, reviewer: createReviewer(model) };
  return { db, rail, model, catalog, purchases, agent: { db, model, catalog, purchases } };
}

async function underDailyCap(db: Database): Promise<boolean> {
  try {
    const period = new Date().toISOString().slice(0, 10);
    const [counter] = await db.query<{ count: number }>(
      `INSERT INTO usage_counters (kind, period, count) VALUES ('ai_request', $1, 1)
       ON CONFLICT (kind, period) DO UPDATE SET count = usage_counters.count + 1
       RETURNING count`,
      [period],
    );
    return counter.count <= AI_DAILY_CAP;
  } catch {
    // If the count can't be read, fail safe: the purchase goes to the owner.
    return false;
  }
}
