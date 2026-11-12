import { updateMember } from "@/domain/members";
import { loadHouseholdPool } from "@/server/api";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { memberResponse, readRules, rulesSchema } from "@/server/members";
import { requireSession } from "@/server/session";

/** Changes a member's limit, approval amount and stores. Owner only, under the pool lock. */
export async function POST(request: Request, context: { params: Promise<{ id: string; memberId: string }> }) {
  return handle(request, async () => {
    const { id, memberId } = await context.params;
    const { db } = await getContainer();
    const session = await requireSession(db);
    const pool = await loadHouseholdPool(db, session, id);
    const { rules } = await readRules(request, rulesSchema);
    const member = await updateMember(db, { poolId: pool.id, memberId, userId: session.user.id, rules });
    return memberResponse(member);
  });
}
