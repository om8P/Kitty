import Link from "next/link";
import { redirect } from "next/navigation";
import { NewPoolForm } from "@/components/NewPoolForm";
import { Shell } from "@/components/Shell";
import { getContainer } from "@/server/container";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create a pool · Kitty" };

export default async function NewPoolPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const { db, rail } = await getContainer();
  const session = await getSession(db);
  if (!session) redirect("/");
  if (session.user.role !== "owner") redirect("/shop");

  const { cancelled } = await searchParams;
  const teen = session.users.find((user) => user.role === "member");

  return (
    <Shell session={session} active="pools" payments={rail.name} narrow>
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <p className="small">
            <Link href="/pools">All pools</Link>
          </p>
          <h1>Create a pool</h1>
          <p className="muted">Set a budget aside once, then decide who can spend it and how.</p>
        </div>
        {cancelled && (
          <div className="notice" role="status">
            <span>
              <strong>The PayPal approval was cancelled.</strong> Nothing was held. Adjust the pool and try again.
            </span>
          </div>
        )}
        <NewPoolForm teenName={teen?.name ?? "Family member"} simulated={rail.name === "simulated"} />
      </div>
    </Shell>
  );
}
