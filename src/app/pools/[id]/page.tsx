import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PoolDashboard } from "@/components/PoolDashboard";
import { Shell } from "@/components/Shell";
import { formatUsd } from "@/domain/money";
import { getPoolState } from "@/domain/pools";
import { toPoolStateView } from "@/lib/views";
import { capabilitiesOf } from "@/server/api";
import { getContainer } from "@/server/container";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pool · Kitty" };

export default async function PoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const container = await getContainer();
  const session = await getSession(container.db);
  if (!session) redirect("/");

  const state = await getPoolState(container.db, id);
  if (!state || state.pool.household_id !== session.householdId) notFound();
  const payments = container.rail.name;

  // Permission state: say who can see this and how to get there.
  if (state.pool.owner_user_id !== session.user.id) {
    const owner = session.users.find((user) => user.id === state.pool.owner_user_id);
    return (
      <Shell session={session} payments={payments} narrow>
        <div className="empty">
          <h1>Only the owner can manage this pool</h1>
          <p className="muted">
            You&rsquo;re viewing Kitty as {session.user.name}. Switch to {owner?.name ?? "the owner"} in the header to
            see the balance, approve purchases and close the pool.
          </p>
          <Link className="button" href="/shop">
            Go to the shop
          </Link>
        </div>
      </Shell>
    );
  }

  const view = toPoolStateView(state, capabilitiesOf(container));

  if (view.pool.status === "awaiting_payer") {
    return (
      <Shell session={session} active="pools" payments={payments} narrow>
        <div className="empty">
          <h1>Waiting for your PayPal approval</h1>
          <p className="muted">
            &ldquo;{view.pool.goal}&rdquo; opens once PayPal confirms the{" "}
            <span className="money">{formatUsd(view.pool.requestedCents)}</span> hold. Nothing has been held or spent
            yet. If you already approved it, check again.
          </p>
          <div className="row">
            <a className="button" href={`/api/paypal/return?token=${encodeURIComponent(view.pool.pendingOrderId ?? "")}`}>
              Check again
            </a>
            <Link className="button button--secondary" href="/pools/new">
              Start a new pool
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell session={session} active="pools" payments={payments}>
      <PoolDashboard initial={view} />
    </Shell>
  );
}
