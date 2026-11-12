import { z } from "zod";
import { createDemoHousehold } from "@/domain/pools";
import { DomainError } from "@/domain/types";
import { takeDemoHousehold } from "@/server/demo-limit";
import { getContainer } from "@/server/container";
import { handle, readJson } from "@/server/http";
import { accessCodeMatches, setSessionCookie } from "@/server/session";

const bodySchema = z.object({ code: z.string().max(200).optional() });

/** Creates a fresh demo household and signs the visitor in as its owner. */
export async function POST(request: Request) {
  return handle(request, async () => {
    const body = bodySchema.safeParse(await readJson(request));
    if (!body.success || !accessCodeMatches(body.data.code)) {
      throw new DomainError("forbidden", "That access code isn't right. Check the submission notes and try again.");
    }
    const { db } = await getContainer();
    if (!(await takeDemoHousehold(db))) {
      throw new DomainError("conflict", "Kitty's demo has reached today's limit of new households. Try again tomorrow.");
    }
    const household = await createDemoHousehold(db);
    await setSessionCookie({ householdId: household.householdId, userId: household.owner.id });
    return Response.json({ ok: true });
  });
}
