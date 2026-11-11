import { z } from "zod";
import { submitPurchase } from "@/domain/purchases";
import { SELECT_MEMBERS } from "@/domain/stores";
import { DomainError, type MemberRow } from "@/domain/types";
import { toPurchaseView } from "@/lib/views";
import { loadHouseholdPool } from "@/server/api";
import { getContainer } from "@/server/container";
import { handle, readJson } from "@/server/http";
import { requireSession } from "@/server/session";

const bodySchema = z.object({
  poolId: z.string().min(1).max(64),
  productId: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(20),
  /** One ID per tap on Buy, so a retry or double tap finds the same purchase. */
  requestKey: z.string().min(8).max(64),
});

/**
 * A family member asks to buy something. The member comes from the session
 * and the price from our own products table. Neither comes from the request.
 */
export async function POST(request: Request) {
  return handle(request, async () => {
    const { db, purchases } = await getContainer();
    const session = await requireSession(db);
    const body = bodySchema.safeParse(await readJson(request));
    if (!body.success) throw new DomainError("invalid", "That request wasn't complete. Try again.");

    const pool = await loadHouseholdPool(db, session, body.data.poolId);
    const [member] = await db.query<MemberRow>(`${SELECT_MEMBERS} WHERE pool_id = $1 AND user_id = $2`, [
      pool.id,
      session.user.id,
    ]);
    if (!member) {
      throw new DomainError("forbidden", `${session.user.name} isn't a spending member of this pool.`);
    }

    const purchase = await submitPurchase(purchases, {
      poolId: pool.id,
      memberId: member.id,
      productId: body.data.productId,
      quantity: body.data.quantity,
      idempotencyKey: `${member.id}:${body.data.requestKey}`,
    });
    return Response.json({ purchase: toPurchaseView(purchase, [member]) });
  });
}
