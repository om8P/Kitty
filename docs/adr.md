# Kitty Architecture Decision Records

Key decisions behind `docs/architecture.md`. Most are still `proposed`. ADR-0002 and ADR-0006 are `accepted`, and ADR-0003 has a recorded S08 note.

| ADR | Title | Status | Date |
|---|---|---|---|
| 0001 | One Next.js service on an always-on Node process | proposed | 2026-11-10 |
| 0002 | Host on Render free, Supabase free Postgres and a GitHub Actions schedule | accepted | 2026-11-11 |
| 0003 | Kitty's ledger is the spending authority | proposed | 2026-11-10 |
| 0004 | Hard rules run in code first, and AI can only tighten | proposed | 2026-11-10 |
| 0005 | Use Groq's free plan behind a model seam | proposed | 2026-11-10 |
| 0006 | Build pools on PayPal authorization and partial capture | accepted (S08, 2026-11-11) | 2026-11-10 |
| 0007 | Keep Channel3 behind a catalog seam with minimal storage | proposed | 2026-11-10 |

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
