import Link from "next/link";
import { redirect } from "next/navigation";
import { BalanceBar } from "@/components/BalanceBar";
import { Shell } from "@/components/Shell";
import { PoolStatusBadge } from "@/components/PoolStatusBadge";
import { formatUsd } from "@/domain/money";
import { listPools } from "@/domain/pools";
import { formatDay } from "@/lib/labels";
import { toPoolView, type PoolView } from "@/lib/views";
import { getContainer } from "@/server/container";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pools · Kitty" };

export default async function PoolsPage() {
  const { db, rail } = await getContainer();
  const session = await getSession(db);
  if (!session) redirect("/");
  if (session.user.role !== "owner") redirect("/shop");

  const pools = (await listPools(db, session.householdId)).map(toPoolView);

  return (
    <Shell session={session} active="pools" payments={rail.name}>
      <div className="stack stack--loose">
        <div className="row row--between">
          <h1>Pools</h1>
          {pools.length > 0 && (
            <Link className="button" href="/pools/new">
              Create a pool
            </Link>
          )}
        </div>

        {pools.length === 0 ? (
          <div className="empty">
            <h2>No pools yet</h2>
            <p className="muted">
              A pool sets a budget aside in PayPal with one approval. Your family and your shopping agent then spend
              from it within the limits you choose.
            </p>
            <Link className="button" href="/pools/new">
              Create a pool
            </Link>
          </div>
        ) : (
          <ul className="pool-list">
            {pools.map((pool) => (
              <li key={pool.id}>
                <Link className="pool-link" href={`/pools/${pool.id}`}>
                  <div className="row row--between">
                    <h2>{pool.goal}</h2>
                    <PoolStatusBadge pool={pool} />
                  </div>
                  <PoolSummary pool={pool} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}

function PoolSummary({ pool }: { pool: PoolView }) {
  if (pool.status === "awaiting_payer") {
    return (
      <p className="muted" style={{ marginBlockStart: "var(--space-2)" }}>
        Waiting for your approval on PayPal for <span className="money">{formatUsd(pool.requestedCents)}</span>.
      </p>
    );
  }
  return (
    <div style={{ marginBlockStart: "var(--space-3)" }}>
      <BalanceBar
        compact
        authorizedCents={pool.authorizedCents}
        capturedCents={pool.capturedCents}
        reservedCents={pool.reservedCents}
        availableCents={pool.availableCents}
      />
      <p className="muted small">
        {pool.status === "closed" ? (
          <>
            <span className="money">{formatUsd(pool.capturedCents)}</span> spent ·{" "}
            <span className="money">{formatUsd(pool.releasedCents)}</span> released
          </>
        ) : (
          <>
            <span className="money">{formatUsd(pool.availableCents)}</span> available of{" "}
            <span className="money">{formatUsd(pool.authorizedCents)}</span> · ends {formatDay(pool.endsAt)}
          </>
        )}
      </p>
    </div>
  );
}
