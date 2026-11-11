import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Shop } from "@/components/Shop";
import type { PurchaseRow } from "@/domain/types";
import { toMemberView, toPoolView, toPurchaseView, type ShopView } from "@/lib/views";
import { capabilitiesOf, findMemberPool } from "@/server/api";
import { getContainer } from "@/server/container";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shop · Kitty" };

export default async function ShopPage() {
  const container = await getContainer();
  const session = await getSession(container.db);
  if (!session) redirect("/");
  const payments = container.rail.name;
  const owner = session.users.find((user) => user.role === "owner");
  const teen = session.users.find((user) => user.role === "member");

  // Permission state: the owner funds the pool but isn't a spending member.
  if (session.user.role === "owner") {
    return (
      <Shell session={session} payments={payments} narrow>
        <div className="empty">
          <h1>The shop is for spending members</h1>
          <p className="muted">
            You&rsquo;re viewing Kitty as {session.user.name}, the owner. Switch to {teen?.name ?? "a family member"} in
            the header to shop from the pool, or send the shopping agent from a pool&rsquo;s page.
          </p>
          <Link className="button" href="/pools">
            Go to your pools
          </Link>
        </div>
      </Shell>
    );
  }

  const found = await findMemberPool(container.db, session);
  const capabilities = capabilitiesOf(container);
  let view: ShopView = { pool: null, member: null, purchases: [], capabilities };
  if (found) {
    const purchases = await container.db.query<PurchaseRow>(
      "SELECT * FROM purchases WHERE member_id = $1 ORDER BY created_at DESC LIMIT 30",
      [found.member.id],
    );
    view = {
      pool: toPoolView(found.pool),
      member: toMemberView(found.member),
      purchases: purchases.map((purchase) => toPurchaseView(purchase, [found.member])),
      capabilities,
    };
  }
  const products = found ? await container.catalog.featured() : [];

  return (
    <Shell session={session} active="shop" payments={payments}>
      <Shop initial={view} initialProducts={products} ownerName={owner?.name ?? "the owner"} />
    </Shell>
  );
}
