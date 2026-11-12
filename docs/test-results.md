# Test results

Results of the runs against the real PayPal sandbox and Postgres. Each section names the plan step it closes. No account details or secrets are recorded here.

## M4: built flows against the PayPal sandbox

**Run on 2026-11-12, session N3, branch `session/N3-sandbox-check`.** Local app (`npm run dev`) on the Docker Postgres, with the real sandbox keys, `CATALOG_PROVIDER=seeded` and Groq `openai/gpt-oss-120b` for review and the agent. The owner approved the pool at PayPal as the sandbox personal buyer. Webhooks went to the S07 receiver through an ngrok tunnel.

Pool `22850765-…`: "Weekly groceries", $150, 4 weeks. Sam (teen): $40 limit, asks above $15, Fresh Market and Corner Pharmacy. Shopping agent: $80 limit, asks above $25, Fresh Market.

| # | Flow | Steps | Result | Closes |
|---|---|---|---|---|
| 1 | Create and approve a pool | Owner filled the form, approved $150 at PayPal | Pass. Pool `active`. `authorized_cents` 15000 came from PayPal's authorization `7VY88771FT5588641`. The new `authorizations` row has `expires_at` 2026-12-11 05:02:50Z (PayPal's) and `honor_ends_at` 2026-11-15 05:02:50Z (26 days earlier), status `active` | S24 |
| 2 | A member buys within rules, and a rule breaker is stopped | Sam bought milk ($3.89), then wireless headphones ($59.99, Gadget Hub) | Pass. Milk `captured` (capture `8J998263PM575800X`), shown as "Paid". Headphones `rejected_by_rules` (`store_not_allowed`) with no `ai_decision`, so no AI call was made | S32 |
| 2a | AI blocks an off-goal purchase | Sam tried a GameVault gift card ($25) | Pass. `blocked_by_ai`: "A video game gift card does not match the weekly groceries goal." | — |
| 3 | Approval: one approved, one denied, from the ledger | Sam asked for energy drinks ($21.99) twice, and the AI flagged both. The owner pressed Approve on one row and Deny on the other in the AG Grid ledger | Pass. The approved one was captured (`2J15450221244583M`), the other `denied`. All 5 grid rows were the same DOM elements before and after, so rows update in place by purchase ID. The dashboard polls every 2 s. AI reasons show as plain text in the "AI check" column (no `innerHTML` anywhere in `src`) | S34 |
| 4 | One agent run within free limits | "Get breakfast basics for the week" | Pass, with a finding. Four searches, then milk, eggs and bread were bought and captured, and appear in the owner's ledger as "Shopping agent". The run then stopped with "The agent is at its free AI limit right now. Purchases already made still stand." See the finding below | S36 |
| 5 | Refund, then close | Owner refunded the agent's bread ($2.99) from the ledger, then closed the pool | Pass. Bread `refunded` (refund `6HN74696J5234724H`). Available stayed $113.65: the refund went back to PayPal, not into the pool. Closing voided the remainder: pool `closed`, `released_cents` 11365, `authorizations` row `voided` | S37 |

### Ledger against PayPal (after all flows)

| | Kitty | PayPal sandbox |
|---|---|---|
| Authorized | 15000 (`authorize` entry) | $150.00, authorization `7VY88771FT5588641` |
| Captured | 3635 in 5 `capture` entries | 5 captures, $36.35 |
| Refunded | 299 | capture `8H3081242B853561R` `REFUNDED`, $2.99 |
| Released | 11365 (`void` entry) | authorization `VOIDED` |

Every capture carries `invoice_id: kitty-{purchase id}`, matching its Kitty purchase. **No mismatch.**

### Webhooks during M4

8 events arrived live (authorization created and voided, 5 captures, 1 refund), and all 8 signatures verified. With the 8 from S06a, that's 16 of 16. See `docs/spike/S07.md`.

### Agreement with S06a

- **Q6:** the refund made no money spendable, in the app as at PayPal.
- **Q4:** closing a partly captured pool voided the remainder, in the app as at PayPal.

### Findings

- **The agent hits Groq's per-minute free limit on a four-item task.** The daily caps were far away (15 requests and 9,390 tokens, against 800 and 150,000). But each agent purchase also runs an AI review, and the run used about 9,400 tokens in 14 seconds, past Groq's free 8,000 tokens a minute (S10). The model seam waits at most 20 seconds for a rate limit, then fails safe, so the run stopped after 3 of 4 items with the documented message, and its purchases stood. This is arch 8's safe failure, not a defect. A smoother run would need pacing between agent turns: a candidate for S49 (N6), which sets the AI caps for shared use.
- **Defects found and fixed in N3, with tests:**
  - `MAX_CAPTURE_AMOUNT_EXCEEDED` was classified `unknown` instead of `failed` (S06a).
  - `CATALOG_PROVIDER=seeded`, the plan's spelling, was not recognized, so the app would have used Channel3 whenever its key was set.
- **Not checked here:** a capture decline (the sandbox can't force one), and the phone layout beyond what the flows needed (S50 and E3).

## S40: milestone 3 scenarios (gate)

**Run on 2026-11-12, session N5, branch `session/N5-gate-deploy`.** `scripts/gate/s40-scenarios.ts` drove the app's own wiring (`getContainer`): the Docker Postgres, the real PayPal sandbox rail and the live Groq reviewer (`openai/gpt-oss-120b`), with the seeded catalog. The owner approved a $40 "Weekly groceries" pool at PayPal as the sandbox buyer. Sam (teen): $40 limit, no rule-based approval, Fresh Market, Corner Pharmacy, Style Street and Gadget Hub. Shopping agent: $40 limit, Fresh Market.

| # | Scenario | Result |
|---|---|---|
| 1 | Replay: milk ($3.89) sent twice with one idempotency key | Pass. One purchase, `captured`, one capture at PayPal |
| 2 | Rule breakers: a store not allowed, over the member limit ($59.99), over the pool balance (7 cereal, $37.03 against $36.11 left), and the agent after the owner removed it | Pass. All four `rejected_by_rules` with the expected code (`store_not_allowed`, `over_member_limit`, `over_pool_balance`, `member_inactive`), no `ai_decision`, and 0 AI requests counted while they ran |
| 3 | Off-goal spot check, live reviewer: gift card, the mystery figure with an instruction hidden in its description, energy drinks, hoodie, gaming mouse, phone charger | Pass, 6 of 6. Five `blocked_by_ai`, energy drinks flagged (`awaiting_approval`, then denied by the owner). The reviewer named the hidden instruction. A spot check, not a measured rate (S39 measures it after the submission) |
| 4 | Race tests on real Postgres (`src/domain/races.test.ts`) | Pass, 4 of 4. 0 pools overspent |
| 5 | Pool integrity: Kitty's captured total against PayPal's order | Pass. Kitty $3.89 in 1 capture, PayPal $3.89 in 1, every capture's `invoice_id` names its purchase. Reserved $0 |
| 6 | Close | The pool closed and PayPal released the remaining $36.11 |

Baseline at the time: lint, typecheck and 589 tests pass, including `tests/gate/s40-helpers.test.ts` for the integrity comparison. **S40 passes.**

## S48: production deploy

**Run on 2026-11-12, session N5.** The S12 Render free web service and Supabase free project, reused. The owner entered every secret in Render and GitHub, added a sandbox webhook for the hosted URL in PayPal, and deployed `main` (N4's code) by hand. No card was asked for or added. The hosted URL is kept out of this public repo.

| Check | Result |
|---|---|
| `/api/health` | `status: "ok"`, `db: "ok"`, `dbTls: "verified"`, about 0.5 s warm |
| Migrations | Applied. The app runs the Drizzle migrations before its first database call (ADR-0010) and logs no line for it, so the evidence is `db: "ok"` and the tick reading the tables that only the migrations create |
| Tick without a secret, or with a wrong one | 401 both times |
| Tick from the Schedule workflow with the repo's `CRON_SECRET` | 200 with every job count at 0 (a manual run at 08:27 UTC) |
| Unsigned event to `/api/paypal/webhook` | 401, "The signature didn't verify." |
| Sandbox purchase and its webhook | Passed in S47a below |
| Scheduled runs | Green, but only about every 6 to 7 hours (18:09, 00:37 and 07:41 UTC), not every 5 minutes |
| Stays awake | **No.** Render sleeps after 15 idle minutes, so between scheduled runs the first visitor waits for a cold start, and the tick's recovery runs only every few hours. See the finding |

**Finding:** GitHub's schedule alone can't keep the free instance awake or run the tick often. A free outside pinger that calls `/api/health` every 10 minutes would keep it awake. That would be a new free service account, so it's the owner's decision (recorded in `plan.md`).

