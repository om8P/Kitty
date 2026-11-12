import { after } from "next/server";
import { z } from "zod";
import { runAgent, startAgentRun } from "@/ai/agent";
import { DomainError } from "@/domain/types";
import { loadHouseholdPool } from "@/server/api";
import { getContainer } from "@/server/container";
import { handle, readJson } from "@/server/http";
import { requireSession } from "@/server/session";

const bodySchema = z.object({ task: z.string().max(600) });

/** Starts an agent run and returns at once. The run continues after the response, and the dashboard polls it. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const { id } = await context.params;
    const container = await getContainer();
    const session = await requireSession(container.db);
    const pool = await loadHouseholdPool(container.db, session, id);
    const body = bodySchema.safeParse(await readJson(request));
    if (!body.success) throw new DomainError("invalid", "Tell the agent what to shop for.");
    if (!container.model.configured) {
      throw new DomainError("conflict", "The agent needs a GROQ_API_KEY to run. Add one and restart Kitty.");
    }

    const run = await startAgentRun(
      container.db,
      { poolId: pool.id, userId: session.user.id, task: body.data.task },
      container.quota,
    );
    after(() => runAgent(container.agent, run.id));
    return Response.json({ runId: run.id });
  });
}
