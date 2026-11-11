import { redirect } from "next/navigation";
import { BalanceBar } from "@/components/BalanceBar";
import { Shell } from "@/components/Shell";
import { StartDemo } from "@/components/StartDemo";
import { getContainer } from "@/server/container";
import { accessCodeRequired, getSession } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { db, rail } = await getContainer();
  const session = await getSession(db);
  if (session) redirect(session.user.role === "owner" ? "/pools" : "/shop");

  return (
    <Shell session={null} payments={rail.name}>
      <div className="stack stack--loose">
        <section className="hero">
          <div className="stack" style={{ gap: "var(--space-5)" }}>
            <h1>Approve once. Let your family and your AI agent spend within limits.</h1>
            <p className="hero__lede">
              Kitty sets a budget aside in PayPal with one approval. Each person and each AI agent gets their own
              limit, and every purchase is checked against your rules before a cent moves.
            </p>
            <StartDemo codeRequired={accessCodeRequired()} />
          </div>

          <div className="hero__panel" aria-label="Example pool">
            <p className="muted small">Weekly groceries · held on PayPal</p>
            <div className="balance__headline" style={{ marginBlockStart: "var(--space-2)" }}>
              <span className="balance__amount">$96.40</span>
              <span className="muted">available of $150.00</span>
            </div>
            <BalanceBar authorizedCents={15000} capturedCents={4710} reservedCents={650} availableCents={9640} />
          </div>
        </section>

        <section aria-labelledby="how-title" className="stack">
          <h2 id="how-title">How a pool works</h2>
          <ol className="how">
            <li>
              <h3>Set money aside once</h3>
              <p className="muted">You approve one amount in PayPal. It is held, not charged.</p>
            </li>
            <li>
              <h3>Give each spender rules</h3>
              <p className="muted">A limit, the stores they can use, and the amount above which they ask you first.</p>
            </li>
            <li>
              <h3>Every purchase is checked</h3>
              <p className="muted">Hard limits run first. Then AI checks that the item fits the pool&rsquo;s goal.</p>
            </li>
            <li>
              <h3>Close and get the rest back</h3>
              <p className="muted">Only what was spent is charged. The unspent hold is released.</p>
            </li>
          </ol>
        </section>
      </div>
    </Shell>
  );
}
