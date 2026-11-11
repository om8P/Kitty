import type { ProductView } from "@/lib/views";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { requireSession } from "@/server/session";

export const dynamic = "force-dynamic";

/** Marketplace search. With no query it returns the sample shelf, which costs no Channel3 search. */
export async function GET(request: Request) {
  return handle(request, async () => {
    const { db, catalog } = await getContainer();
    await requireSession(db);
    const query = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 120).trim();
    const products: ProductView[] = query ? await catalog.search(query) : await catalog.featured();
    return Response.json({ query, products });
  });
}
