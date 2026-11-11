import Link from "next/link";
import type { Session } from "@/server/session";
import { PersonaSwitcher } from "./PersonaSwitcher";

type Props = {
  session: Session | null;
  active?: "pools" | "shop";
  payments?: "paypal" | "unconfigured" | "test";
  narrow?: boolean;
  children: React.ReactNode;
};

/** The page frame: skip link, header with the persona switcher, and the main landmark. */
export function Shell({ session, active, payments, narrow = false, children }: Props) {
  const isOwner = session?.user.role === "owner";
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link className="brand" href={session ? (isOwner ? "/pools" : "/shop") : "/"}>
            <KittyMark />
            Kitty
          </Link>
          {session && (
            <nav className="site-nav" aria-label="Main">
              {isOwner ? (
                <Link href="/pools" aria-current={active === "pools" ? "page" : undefined}>
                  Pools
                </Link>
              ) : (
                <Link href="/shop" aria-current={active === "shop" ? "page" : undefined}>
                  Shop
                </Link>
              )}
            </nav>
          )}
          <div className="header-tools">
            <span className="badge badge--outline badge--plain" title="No real money moves in this demo">
              {payments === "paypal" || payments === undefined ? "PayPal sandbox" : "Sandbox · PayPal isn't set up"}
            </span>
            {session && <PersonaSwitcher people={session.users} currentId={session.user.id} />}
          </div>
        </div>
      </header>
      <main id="main" className={narrow ? "page page--narrow" : "page"}>
        {children}
      </main>
    </>
  );
}

/** Kitty's own mark: a coin dropping into a slot. Never a PayPal logo. */
export function KittyMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="var(--navy)" />
      <circle cx="14" cy="11" r="5" fill="var(--sky)" />
      <rect x="6" y="18" width="16" height="3" rx="1.5" fill="#fff" />
    </svg>
  );
}
