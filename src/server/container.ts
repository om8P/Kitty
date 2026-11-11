import { createCatalog } from "@/adapters/catalog/catalog";
import { createRail } from "@/adapters/payments/rail";
import type { AgentDeps } from "@/ai/agent";
import { createUsageBudget } from "@/ai/budget";
import { createGroqModel, type Model } from "@/ai/model";
import { createReviewer } from "@/ai/reviewer";
import { getDatabase } from "@/db/client";
import type { Catalog, Database, PaymentRail } from "@/domain/ports";
import type { PurchaseDeps } from "@/domain/purchases";

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
  // Daily caps below Groq's free limits, so reviews fail safe, not hard.
  const model = createGroqModel(process.env, { budget: createUsageBudget(db) });
  const catalog = createCatalog(db);
  const purchases: PurchaseDeps = { db, rail, reviewer: createReviewer(model) };
  return { db, rail, model, catalog, purchases, agent: { db, model, catalog, purchases } };
}
