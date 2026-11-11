import { approvePurchase, denyPurchase, recheckCapture, refundPurchase } from "@/domain/purchases";
import { DomainError, type PurchaseRow } from "@/domain/types";
import { loadHouseholdPool } from "@/server/api";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { requireSession } from "@/server/session";

const ACTIONS = {
  approve: approvePurchase,
  deny: denyPurchase,
  refund: refundPurchase,
  recheck: recheckCapture,
} as const;

/** Owner decisions from the ledger. The domain checks ownership again and re-runs every hard rule. */
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  return handle(request, async () => {
    const { id, action } = await context.params;
    const run = Object.hasOwn(ACTIONS, action) ? ACTIONS[action as keyof typeof ACTIONS] : undefined;
    if (!run) throw new DomainError("not_found", "That action doesn't exist.");

    const { db, purchases } = await getContainer();
    const session = await requireSession(db);
    const [purchase] = await db.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1", [id]);
    if (!purchase) throw new DomainError("not_found", "That purchase doesn't exist.");
    await loadHouseholdPool(db, session, purchase.pool_id);

    const updated = await run(purchases, { purchaseId: purchase.id, userId: session.user.id });
    return Response.json({ status: updated.status, message: updated.message });
  });
}
