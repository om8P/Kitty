import type { PurchaseRow } from "@/domain/types";
import { toMemberView, toPoolView, toPurchaseView, type ShopView } from "@/lib/views";
import { capabilitiesOf, findMemberPool } from "@/server/api";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { requireSession } from "@/server/session";

export const dynamic = "force-dynamic";

/** What a family member sees: their pool, their own limit and their own requests. */
export async function GET(request: Request) {
  return handle(request, async () => {
    const container = await getContainer();
    const session = await requireSession(container.db);
    const found = await findMemberPool(container.db, session);
    const capabilities = capabilitiesOf(container);
    if (!found) {
      const empty: ShopView = { pool: null, member: null, purchases: [], capabilities };
      return Response.json(empty);
    }
    const purchases = await container.db.query<PurchaseRow>(
      "SELECT * FROM purchases WHERE member_id = $1 ORDER BY created_at DESC LIMIT 30",
      [found.member.id],
    );
    const view: ShopView = {
      pool: toPoolView(found.pool),
      member: toMemberView(found.member),
      purchases: purchases.map((purchase) => toPurchaseView(purchase, [found.member])),
      capabilities,
    };
    return Response.json(view);
  });
}
