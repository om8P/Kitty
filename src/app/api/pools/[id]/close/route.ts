import { closePool } from "@/domain/pools";
import { toPoolView } from "@/lib/views";
import { loadHouseholdPool } from "@/server/api";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { requireSession } from "@/server/session";

/** Closes the pool and releases the unspent hold. Owner only, checked in the domain. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const { id } = await context.params;
    const { db, rail } = await getContainer();
    const session = await requireSession(db);
    const pool = await loadHouseholdPool(db, session, id);
    const closed = await closePool({ db, rail }, { poolId: pool.id, userId: session.user.id });
    return Response.json({ pool: toPoolView(closed) });
  });
}
