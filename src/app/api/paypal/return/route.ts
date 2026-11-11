import { confirmPool } from "@/domain/pools";
import type { PoolRow } from "@/domain/types";
import { getContainer } from "@/server/container";
import { baseUrl } from "@/server/http";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * PayPal sends the owner back here after the one approval. The order is
 * authorized, the pool opens, and the owner lands on its dashboard. If PayPal
 * hasn't confirmed yet, the pool page explains and offers to check again.
 */
export async function GET(request: Request) {
  const origin = baseUrl(request);
  const orderId = new URL(request.url).searchParams.get("token");
  try {
    const { db, rail } = await getContainer();
    const session = await getSession(db);
    if (!session) return Response.redirect(`${origin}/`, 303);
    if (!orderId) return Response.redirect(`${origin}/pools`, 303);

    const [pool] = await db.query<PoolRow>("SELECT * FROM pools WHERE paypal_order_id = $1 AND household_id = $2", [
      orderId,
      session.householdId,
    ]);
    if (!pool) return Response.redirect(`${origin}/pools`, 303);
    try {
      await confirmPool({ db, rail }, { orderId, householdId: session.householdId });
    } catch {
      // The pool stays `awaiting_payer`, and its page says so.
    }
    return Response.redirect(`${origin}/pools/${pool.id}`, 303);
  } catch {
    return Response.redirect(`${origin}/pools`, 303);
  }
}
