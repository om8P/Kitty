import { getPoolState } from "@/domain/pools";
import { DomainError } from "@/domain/types";
import { toPoolStateView } from "@/lib/views";
import { capabilitiesOf, loadHouseholdPool, requireOwner } from "@/server/api";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { requireSession } from "@/server/session";

export const dynamic = "force-dynamic";

/** The owner's dashboard reads this every couple of seconds. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const { id } = await context.params;
    const container = await getContainer();
    const session = await requireSession(container.db);
    const pool = await loadHouseholdPool(container.db, session, id);
    requireOwner(session, pool);
    const state = await getPoolState(container.db, pool.id);
    if (!state) throw new DomainError("not_found", "That pool doesn't exist.");
    return Response.json(toPoolStateView(state, capabilitiesOf(container)));
  });
}
