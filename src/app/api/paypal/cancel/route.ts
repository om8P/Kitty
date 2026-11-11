import { abandonPool } from "@/domain/pools";
import { getContainer } from "@/server/container";
import { baseUrl } from "@/server/http";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

/** The owner backed out on PayPal's page. Nothing was held, so the pool is dropped. */
export async function GET(request: Request) {
  const origin = baseUrl(request);
  const orderId = new URL(request.url).searchParams.get("token");
  try {
    const { db } = await getContainer();
    const session = await getSession(db);
    if (session && orderId) await abandonPool(db, { orderId, householdId: session.householdId });
  } catch {
    // Falling through to the form is the safe result either way.
  }
  return Response.redirect(`${origin}/pools/new?cancelled=1`, 303);
}
