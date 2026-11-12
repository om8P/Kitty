# Kitty Architecture Decision Records

Key decisions behind `docs/architecture.md`. Most are still `proposed`. ADR-0002, ADR-0006, ADR-0008, ADR-0009 and ADR-0010 are `accepted`, and ADR-0003 has a recorded S08 note.

| ADR | Title | Status | Date |
|---|---|---|---|
| 0001 | One Next.js service on an always-on Node process | proposed | 2026-11-10 |
| 0002 | Host on Render free, Supabase free Postgres and a GitHub Actions schedule | accepted | 2026-11-11 |
| 0003 | Kitty's ledger is the spending authority | proposed | 2026-11-10 |
| 0004 | Hard rules run in code first, and AI can only tighten | proposed | 2026-11-10 |
| 0005 | Use Groq's free plan behind a model seam | proposed | 2026-11-10 |
| 0006 | Build pools on PayPal authorization and partial capture | accepted (S08, 2026-11-11) | 2026-11-10 |
| 0007 | Keep Channel3 behind a catalog seam with minimal storage | proposed | 2026-11-10 |
| 0008 | Product direction: continue, both user groups equal, honest hold wording, adversarial demo | accepted | 2026-11-11 |
| 0009 | Match the model and catalog seams, and the ledger's entry kinds, to the built code | accepted | 2026-11-11 |
| 0010 | Drizzle owns the schema and migrations, and domain SQL stays behind the transaction port | accepted | 2026-11-11 |

---

## ADR-0001: One Next.js service on an always-on Node process

**Date**: 2026-11-10
**Status**: proposed
**Deciders**: Project owner, with Claude Code (ecc:architect)

### Context

Kitty needs a web UI, an API, PayPal webhooks, a scheduled job and AI agent runs that can take minutes. It is built by one person or a very small team, on a $0 budget.

### Decision

We use one Next.js App Router and TypeScript service, run with `next start`. Agent runs are background tasks in that process, and each request returns a run ID at once.

### Alternatives Considered

#### Separate backend or worker service
- **Pros**: Agent work is isolated from web traffic.
- **Cons**: A second deployable and more operations.
- **Why not**: No benefit at this size, and it would use up the free plan's service allowance.

#### Serverless functions
- **Pros**: No idle server to run, and fast deploys.
- **Cons**: Time limits on each request.
- **Why not**: Agent runs can outlast a short request.

### Consequences

#### Positive
- UI, API, webhooks and agent runner ship together.

#### Negative
- A process restart ends any agent run in progress. Runs are marked failed, not resumed.

#### Risks
- One small instance serves everything. Agent runs are capped by turns and time, and only one AI call runs at a time.

---

## ADR-0002: Host on Render free, Supabase free Postgres and a GitHub Actions schedule

**Date**: 2026-11-11 (first version 2026-11-10 chose Northflank)
**Status**: accepted
**Deciders**: Project owner, with Claude Code

### Context

The project owner set a $0 budget with no card on any service. Kitty needs public HTTPS webhooks, Postgres, a scheduled job and a server that stays awake during agent runs. The first version of this ADR chose Northflank's Sandbox plan, but in S12 Northflank asked for a card before it would deploy, even though it said the card would not be charged. The owner declined and chose the fallback this ADR already named (`docs/spike/S12.md`).

### Decision

- **App:** one Render free web service, built from the repo's `Dockerfile`.
- **Database:** a Supabase free project, reached through its shared session pooler (IPv4) with TLS checked against Supabase's CA (`DATABASE_CA_CERT`).
- **Schedule:** a GitHub Actions workflow (`.github/workflows/schedule.yml`) calls the app every 5 minutes. That replaces a host cron job and keeps the free instance and the free database from going idle.
- No card is added anywhere.

### Alternatives Considered

#### Northflank Sandbox
- **Pros**: Always on, with Postgres and cron in one place.
- **Why not**: It asked for a card before deploying (S12, 2026-11-11).

#### Render free for everything
- **Why not**: Render cron jobs cost at least $1 a month, and free Render Postgres expires 30 days after creation.

#### Vercel Hobby
- **Pros**: Native Next.js hosting that does not sleep.
- **Cons**: A 5-minute function limit.
- **Why not**: Hobby is non-commercial only, and its terms list processing visitor payments as commercial use.

### Consequences

#### Positive
- Everything is free with no card, and Render is a hackathon sponsor, so Kitty becomes eligible for the Render prize (`docs/hackathon-rules.md`).
- The `Dockerfile` keeps the app portable to another host.

#### Negative
- A free Render instance (0.1 CPU, 512 MB) spins down after 15 minutes with no inbound traffic and takes about a minute to wake. Render may also restart it at any time, so agent runs and in-flight work must recover through the tick jobs (S41a, S41b) rather than rely on an always-on process.
- 750 free instance hours a month per workspace covers one always-awake service, not two.
- GitHub may delay or skip scheduled runs, so the schedule is best effort, and it only runs from `main`.
- Supabase pauses free projects after 7 days of low activity. The 5-minute calls are expected to prevent that **[verify]**.

#### Risks
- If the schedule lapses, PayPal webhooks may hit a sleeping instance. PayPal retries failed deliveries, so the cost is delay rather than loss.
- Render's terms say free instances are not for production. Kitty is a sandbox-only demo.

---

## ADR-0003: Kitty's ledger is the spending authority

**Date**: 2026-11-10
**Status**: proposed
**Deciders**: Project owner, with Claude Code (ecc:architect)

### Context

PayPal may allow captures up to 115% of an authorization by default, so PayPal cannot enforce a pool's limit. Two purchases can race, a capture can time out with an unknown result, and refunds may not restore capacity on the authorization.

### Decision

Every movement of funds happens in a short Postgres transaction that locks the pool row, backed by check constraints. Each capture uses one fixed `PayPal-Request-Id`, funds stay reserved when an outcome is unknown, and a refund does not make money spendable again.

### Alternatives Considered

#### Serializable isolation
- **Pros**: The database detects conflicts automatically.
- **Cons**: Every money path needs retry logic.
- **Why not**: One row lock is simpler and enough.

#### A single conditional UPDATE
- **Pros**: Very small and fast.
- **Cons**: Checks only what fits in one statement.
- **Why not**: It cannot run the whole rule set against one consistent view.

### Consequences

#### Positive
- A pool cannot be overspent, even under concurrent purchases.
- A retried capture cannot create a second charge, provided PayPal honors the request ID.

#### Negative
- All spending in a pool is serialized by one lock.
- A refunded amount stays used against the member's limit until the owner raises it.

#### Risks
- PayPal's replay behavior and refund capacity are untested. Questions Q5 and Q6 cover them, and a ledger mismatch pauses the pool.

#### S08 note (2026-11-11)
The owner confirmed authorize-and-capture as the payment path, based on `docs/spike/S05.md`. One sandbox authorization took 30 partial captures with no PayPal approval step. Replaying a capture with the same `PayPal-Request-Id` returned the original capture and moved no money, within at least one hour. The spike also found that a replay response echoes the replayed request's amount, so the ledger settles a capture from the purchase's own amount and the returned capture ID, never from the response amount (arch 7.2). Refund capacity (Q6) is still open and is checked in S06a.

---

## ADR-0004: Hard rules run in code first, and AI can only tighten

**Date**: 2026-11-10
**Status**: proposed
**Deciders**: Project owner, with Claude Code (ecc:architect)

### Context

AI can be wrong or manipulated, and product text is untrusted. Research suggests people trust a hard cap more than an AI's judgment. Kitty still needs AI to catch purchases that are within limits but off-goal.

### Decision

Hard rules run in pure code before any AI call. AI review can only allow, flag or block, the strictest outcome wins, and any AI failure sends the purchase to owner approval. Agents have only `search_products` and `request_purchase`, and the server sets the member, pool and price.

### Alternatives Considered

#### AI decides, with rules in its prompt
- **Pros**: Less code and more flexible judgment.
- **Cons**: A limit in a prompt can be ignored or manipulated.
- **Why not**: Limits must hold whatever the model does.

#### Rules only, with no AI review
- **Pros**: Simple, predictable and free of AI cost.
- **Cons**: Cannot judge whether a purchase fits the pool's goal.
- **Why not**: Goal review is part of the MVP in the PRD.

### Consequences

#### Positive
- A manipulated agent or reviewer still cannot pass the hard rules or get a higher limit.

#### Negative
- An AI outage sends purchases to the owner, so delegation is less hands-off.

#### Risks
- AI may wrongly allow an off-goal purchase within limits. The labeled test set measures this.

---

## ADR-0005: Use Groq's free plan behind a model seam

**Date**: 2026-11-10
**Status**: proposed
**Deciders**: Project owner, with Claude Code

### Context

The project owner asked for free services, including the AI API. Kitty needs tool calling for the agent and reliable structured output for purchase review.

### Decision

We use Groq's free plan with `openai/gpt-oss-120b` for both jobs, through `groq-sdk`, behind a model seam chosen by `AI_PROVIDER`. The seam paces calls and stops before the free limits.

### Alternatives Considered

#### Claude API
- **Pros**: The original plan.
- **Cons**: No standing free tier, only a small one-time credit.
- **Why not**: It would break the $0 budget.

#### Gemini 3.8 Flash free tier
- **Pros**: Free, with function calling shown in its docs.
- **Cons**: Free-tier content is used to improve Google's products.
- **Why not**: Its free limits are not published. It is the first swap if Groq falls short.

### Consequences

#### Positive
- No AI cost, and changing provider means writing one adapter.

#### Negative
- 8,000 tokens a minute forces short prompts and one AI call at a time.
- Structured output and tool use cannot share a call, so review and agent calls stay separate.

#### Risks
- The model's quality and resistance to manipulated text are untested. The labeled test set decides. If quota runs out, reviews go to owner approval and agent runs stop.
- S10 (2026-11-10) confirmed tool calling, strict JSON-schema output and the 1,000-a-day and 8,000-a-minute limits, and that tools and a schema can't share a call. The owner confirmed the other two free limits in the Groq console (2026-11-11). At `reasoning_effort: low` the reviewer allowed a product whose text told it to, while the default effort flagged it, so review runs at the default effort. See `docs/spike/S10.md`.
- S29a (2026-11-11) moved the reviewer to strict JSON-schema output, still checked with Zod, so no exception to arch 2 is needed. A live run of the built reviewer allowed the on-goal case and blocked both the off-goal case and the injected one.

---

## ADR-0006: Build pools on PayPal authorization and partial capture

**Date**: 2026-11-10
**Status**: accepted (S08, 2026-11-11)
**Deciders**: Project owner, with Claude Code

### Context

Kitty's core promise is one approval, then spending in pieces. PayPal fixes the payee when the order is created, so Kitty is the single merchant. Authorizations last 29 days, with funds firmly honored for 3. Multiple partial captures were untested on this sandbox account when this ADR was written. S05 later confirmed them.

### Decision

Each pool is one PayPal order with `intent: AUTHORIZE`, and each purchase is a partial capture. All PayPal knowledge sits behind one payment rail seam, and pool terms are capped at 28 days.

### Alternatives Considered

#### Saved PayPal through Payment Method Tokens, charging each purchase
- **Pros**: Not limited by an authorization's capture rules.
- **Cons**: Needs PayPal approval and holds no real funds.
- **Why not**: It loses the reservation, so it stays as the fallback adapter.

#### Payouts to separate sellers
- **Pros**: Could support real merchants.
- **Cons**: Needs a PayPal platform setup.
- **Why not**: Out of scope for the MVP in the PRD.

### Consequences

#### Positive
- PayPal is central to the product, and the owner approves only once.

#### Negative
- Spending is limited to Kitty's demo marketplace.
- Holds must be refreshed, and they lapse by day 29.

#### Risks
- If neither partial captures nor the fallback work, Milestone 1 fails. Questions Q1 to Q4 cover this.

#### S08 result (2026-11-11)
Accepted. S05 answered Q1 (yes, with no PayPal approval step) and gave a lower bound for Q2 (30 captures on one authorization, with no cap hit). PayPal's developer pages reviewed on 2026-11-11 state no maximum number of captures, only an amount cap and the 29-day window, so Q2 stays a lower bound. Q3 uses its stated fallback while S06b waits for day 4 (`refreshHold` returns `unsupported` and the pool shows "hold needs refreshing"). Q4, Q6 and Q7 are checked against the built code in S06a, S07 and M4. The Payment Method Tokens fallback (S08a) is skipped. Sandbox accounts must be able to transact in USD, so the README tells judges to use US sandbox accounts.

---

## ADR-0007: Keep Channel3 behind a catalog seam with minimal storage

**Date**: 2026-11-10
**Status**: proposed
**Deciders**: Project owner, with Claude Code

### Context

The project owner chose Channel3 for real product data. Prices must come from the server, not the model, so Kitty needs local product records. Channel3's terms forbid storing "a significant portion" of its catalog or output, and about 1,000 searches are free.

### Decision

Channel3 `/v1/search` sits behind a catalog seam. Kitty stores only the products a search returned, removes unpurchased ones after 24 hours, and switches to a hand-written seeded catalog at 900 searches.

### Alternatives Considered

#### Import a large catalog snapshot
- **Pros**: Fast searches and few API calls.
- **Cons**: Conflicts with the terms.
- **Why not**: Bulk storage is forbidden.

#### Give the agent Channel3's MCP server
- **Pros**: Little integration work.
- **Cons**: Adds tools outside Kitty's control.
- **Why not**: The agent may have only Kitty's two tools.

### Consequences

#### Positive
- Real products within the free allowance, and every purchase uses a local price.

#### Negative
- Unpurchased products must be fetched again after 24 hours.

#### Risks
- The terms may not allow this use at all. Question Q8 covers this, and `CATALOG_PROVIDER` can switch to the seeded catalog. S11 found that the 1,000 free credits renew monthly, and that Channel3's caching guide suggests a shorter retention than 24 hours (`docs/spike/S11.md`).

---

## ADR-0008: Product direction: continue, both user groups equal, honest hold wording, adversarial demo

**Date**: 2026-11-11
**Status**: accepted (S18)
**Deciders**: Project owner, with Claude Code

### Context

The S18 gate asks whether to continue, which user group leads, and whether to make four product changes: position Kitty as a shopping service, make agents the lead audience, reword "reserved", and add an adversarial demo moment. There are no interviews, so this is the owner's decision on the research. `docs/research.md` finds the AI-agent problem better supported than the family one, finds that PayPal offers no reserved, shared budget, and finds at least four hackathon entries with limits or approvals, one aimed at households. PayPal firmly honors an authorization for only 3 of its 29 days (`docs/research.md` section 4, PayPal's two-step payments page).

### Decision

- **Continue** with the current direction: a household layer on PayPal, not a rival to it.
- **Both user groups stay equal.** The shared story stays a parent delegating a grocery budget to an AI agent and a teen. Agents are not made the lead audience.
- **Reword "reserved"** in user-facing text to say the money is held on the owner's PayPal, without promising a guaranteed reservation for the whole term. The ledger's internal names (`reserved_cents`) do not change.
- **Add an adversarial demo moment.** A product listing tries to manipulate the AI agent or reviewer, and the hard rules still stop the purchase.
- **No shopping-service framing,** and the word "pool" is kept.

### Alternatives Considered

#### Lead with AI-agent users
- **Pros**: Stronger survey support, and it matches the "Best Use of Agentic Commerce" prize.
- **Cons**: Weakens the shared family story that sets Kitty apart from agent-only products.
- **Why not**: The owner chose to keep both groups equal.

#### Position Kitty as a shopping service
- **Pros**: Explains why spending happens only at Kitty's marketplace.
- **Cons**: Moves the focus away from the PayPal hold and the shared rules.
- **Why not**: The owner kept the spending-layer framing.

### Consequences

#### Positive
- The pitch claims only what PayPal guarantees, which also fits judging on credibility.
- The adversarial moment shows the hard rules working, which the four rival entries don't show.

#### Negative
- Without a lead group, the demo has to serve two audiences within 3 minutes.

#### Risks
- "Pool" still collides with PayPal Pools. Screens must keep Kitty's own name and the "Sandbox" label so no one mistakes Kitty for PayPal (`rules.md`).

---

## ADR-0009: Match the model and catalog seams, and the ledger's entry kinds, to the built code

**Date**: 2026-11-11
**Status**: accepted (M5)
**Deciders**: Project owner, with Claude Code

### Context

M5 compared the MVP with `docs/architecture.md` (list in `docs/arch-reconciliation.md`). Three differences were on no known list. Arch 3 describes the model seam as two functions, `reviewPurchase` and `agentTurn`, chosen by `AI_PROVIDER`. The code has one `Model` interface, a single chat call with typed failures, and the reviewer and agent runner are built on top of it. Arch 3 gives the catalog seam `search` and `getProduct`. The code has `search` and `featured`, and the purchase service reads the product row by its local ID. The ledger also writes an `authorize` entry when a pool is approved, which arch 6 doesn't list.

### Decision

Amend the architecture to match the code. The model seam is one `Model` interface. The reviewer (`src/ai/reviewer.ts`) and agent runner (`src/ai/agent.ts`) sit on it, and `AI_PROVIDER` picks the adapter once a second one exists (E1). The catalog seam is `search` and `featured`, and a product is always read from `products` by its local ID. `ledger_entries.kind` includes `authorize`.

### Alternatives Considered

#### Reshape the code to the arch
- **Pros**: No arch edit.
- **Cons**: A rewrite of working, tested code before the deadline, for no change in behavior.
- **Why not**: Every rule the seams protect (typed failures, no `allow` on failure, local IDs and prices) already holds.

### Consequences

#### Positive
- S28 keeps the `Model` interface when it adopts `groq-sdk`, so the reviewer and agent don't change.

#### Negative
- A second provider (E1) has to fit the chat-shaped interface.

#### Risks
- None to money. The `authorize` entry records the approved amount and moves no counter.

### Note (N4, 2026-11-12)

The owner settled two more differences the same way, keeping the code and amending the arch:

- **Member status is the `active` flag.** Arch 6 listed a member `status`. `pool_members.active` already does that job: removing a member sets it false, the row and its counters stay, and the `member_inactive` hard rule stops new purchases and any approval of waiting ones. A status column would have added a migration for the same behavior.
- **Channel3 products map to a store by category.** Arch 3 said the offer's `domain` maps to a Kitty store. Kitty's stores are its own demo names, so no retailer domain matches one. The adapter maps the product's category instead (`storeForCategory` in `src/adapters/catalog/catalog.ts`), and anything unmatched goes to "Everything Else".

---

## ADR-0010: Drizzle owns the schema and migrations, and domain SQL stays behind the transaction port

**Date**: 2026-11-11
**Status**: accepted (S19)
**Deciders**: Project owner, with Claude Code

### Context

Arch 2 chose Drizzle ORM with `pg` for "SQL-first migrations, and row locks without raw SQL", and the owner decided on 2026-11-11 to keep that choice. The MVP created its schema with `CREATE TABLE IF NOT EXISTS` at startup, and the domain runs about 60 parameterized SQL statements, including every `FOR UPDATE` lock, through the transaction port in `src/domain/ports.ts`. The domain may import no framework or provider SDK, so it can't use Drizzle's query builder directly. Moving every query behind new repository ports in `src/db` would touch all the domain code and its tests a day before the submission.

S19 also found that Drizzle's node-postgres driver returns `timestamptz` values as strings for raw SQL (`drizzle-orm/node-postgres/session.js`), where `pg` returns `Date` objects. Running the domain's SQL through Drizzle's session would change the type of every date the domain reads.

### Decision

- `src/db/schema.ts` is the schema, written with `drizzle-orm/pg-core`. Constraint names match what Postgres gave the MVP's inline constraints.
- Migrations are SQL files in `drizzle/`, generated by `npm run db:generate` (Drizzle Kit) and reviewed by hand. `0000_baseline.sql` is the MVP's own idempotent SQL, so it changes nothing on a database the MVP made. Later files are additive, or copy data before they drop anything.
- Drizzle's migrator applies them: at startup (`src/db/client.ts`), for each test schema (`src/db/testing.ts`), and by hand (`npm run db:migrate`). An advisory lock serializes concurrent runs.
- The domain keeps its parameterized SQL, including the `FOR UPDATE` row locks, behind the transaction port. `src/db` implements the port on the same `pg` pool. New code in `src/db` may use Drizzle's typed queries.
- CI fails when `src/db/schema.ts` has a change with no migration.

### Alternatives Considered

#### Rewrite every query with Drizzle's query builder behind repository ports
- **Pros**: Matches arch 2's "row locks without raw SQL" literally.
- **Cons**: Touches every domain module and many tests, with the deadline a day away. It would also add a large repository layer that only moves the SQL somewhere else.
- **Why not**: The owner chose the smaller change on 2026-11-11. S20 (I1) moves the ledger SQL into one module and may use Drizzle there.

#### Run the domain's SQL through Drizzle's session (`tx.execute`)
- **Pros**: Drizzle would own transactions too.
- **Cons**: Dates would arrive as strings and every row type would change.
- **Why not**: It changes behavior for no gain. The race tests already prove the `pg` transaction and lock path.

### Consequences

#### Positive
- The existing tests passed unchanged. Migrations are reviewable SQL, run the same way in the app, the tests and CI.
- Fresh and MVP-made databases end up identical, which `src/db/migrations.test.ts` checks.

#### Negative
- Domain SQL is still hand-written. A renamed column is caught by the tests, not by the compiler.

#### Risks
- A hand-edited migration can drift from the schema. CI's `db:generate` check and the schema-match test in `src/db/migrations.test.ts` catch that.
