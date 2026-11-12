# Code and architecture reconciliation (M5)

Run on 2026-11-11, at the end of N1, against `main` plus the N1 branch (`session/N1-land-harden`). It compares `src/`, `package.json`, the `Dockerfile` and `.github/workflows/` with `docs/architecture.md` sections 2, 3, 5, 6, 7.4 and 8. Each difference is marked **fixed by step X** (the step that changes the code to match the arch), **fixed in N1** (already done), or **arch amended** (the arch now matches the code, with its ADR). Run it again at the end of N2 and of I1. After I1 no difference should remain.

**Re-run at the end of N2 (2026-11-11, `session/N2-architecture`).** The N2 rows below now say **fixed in N2**. The re-run found one new difference, marked **open** under section 6 for the owner to decide.

## Section 2: technology

| Difference | Resolution |
|---|---|
| Raw `pg` SQL and startup `CREATE TABLE`, not Drizzle with SQL-first migrations | Fixed in N2 (S19): the Drizzle schema in `src/db/schema.ts` and the SQL migrations in `drizzle/` are applied at startup. The domain keeps parameterized SQL behind the transaction port, and arch 2 is amended to say so (ADR-0010) |
| Plain `fetch` to Groq, not `groq-sdk` | Fixed in N2 (S28) |
| Review uses `json_object` plus Zod, not strict JSON-schema output | Fixed in N2 (S29a). S10 and a live run confirmed strict schema works, so no exception was needed |
| Tests ran on in-memory PGlite, not real Postgres | Fixed in N1 (M2): every database test runs on the Docker Postgres, also in CI |
| The app fell back to PGlite with no `DATABASE_URL` | Fixed in N1 (M3): the app refuses to start without it |
| `schedule.yml` calls `/api/health`, not the tick | Fixed by S41a (N4), as arch 2 already says |

## Section 3: parts and seams

| Difference | Resolution |
|---|---|
| A simulated payment rail was reachable from the app | Fixed in N1 (M3): no keys means an `unconfigured` rail that refuses every call, and the scripted rail lives only in the test helpers |
| Ledger SQL sits inside the purchase and pool services, not a ledger module | Fixed by S20 (I1) |
| Rail lacks `verifyWebhookSignature`, `getCapture` and `holdsRealFunds` | Fixed in N4 (S22) |
| Rail lacks `refreshHold` and `getPoolPaymentState` | Fixed by S44 (I3) and S45 (I2) |
| No webhook handler | Fixed in N4 (S38): `POST /api/paypal/webhook` and `src/domain/webhooks.ts` |
| `src/jobs` is empty: no tick jobs | Fixed by S41a (N4), S41b, S42 and S45 (I2), S44 (I3) |
| Model seam is one `Model` chat interface, not `reviewPurchase` and `agentTurn`, and `AI_PROVIDER` is unused | Arch amended (ADR-0009) |
| Catalog seam is `search` and `featured`, not `search` and `getProduct` | Arch amended (ADR-0009) |
| Model seam has only an app-wide daily cap, with no per-household cap or AI-off switch | Fixed by S49 (N6) |

## Section 5: flows

| Difference | Resolution |
|---|---|
| Agent runs cap turns and purchase requests but have no wall-clock cap (5.7) | Fixed in N2 (S28): 3 minutes |
| No `honor_ends_at`, so a hold past its honor period gets no warning (5.1, 5.2) | The `authorizations` table with `honor_ends_at` was added in N2 (S19), backfilled for existing pools. New pools write their row since N3 (S24), and the warning comes with S44 (I3) |
| No hold refresh (5.5) | Fixed by S44 (I3) |
| Pools the owner never approves are not marked `abandoned` by a timeout (5.1) | Fixed by S41a (N4) |
| Waiting approvals don't expire after a set time, only when the pool closes (5.3) | Fixed by S41a (N4), with `approval_expires_at` from S19 |
| Unknown refund outcomes are not replayed by the tick (5.4) | Fixed by S43 (I2) |
| A pool stuck in `closing` is retried only when the owner closes again (5.6) | Fixed by S41b (I2) |
| Members can't be edited after the pool is created | Fixed in N4 (S25) |

## Section 6: data model and states

| Difference | Resolution |
|---|---|
| Allowed stores in a JSONB column, not `stores` and `member_stores` | Fixed in N2 (S19), with the existing data copied over in order |
| No `authorizations` table. The current hold is a column on `pools` | Fixed in N2 (S19). `pools.authorization_id` stays as the current hold, which arch 6 also lists. S24 writes the first row since N3, and S44 (I3) writes reauthorizations |
| No `refunded_cents` on `pool_members`, and no `needs_attention`, `approval_expires_at` or `decided_by` on `purchases` | Fixed in N2 (S19). Approve and deny write `decided_by`. The others get their writers in S43, S38 and S41a |
| No `webhook_events` table | Fixed in N4 (S38), migration `0003_webhook_events`. Its payload is Kitty's own event shape, not PayPal's raw body, and events Kitty doesn't use aren't stored |
| `usage_counters` has no scope (app or household) | Fixed by S49 (N6) |
| Pool states lack `refreshing` and `paused` | Fixed by S44 (I3) and S45 (I2) |
| `ledger_entries` also has an `authorize` kind | Arch amended (ADR-0009) |
| `pools` has extra columns (`rail`, `requested_cents`, `term_days`, `note`) and `agent_runs` keeps turns inside `steps` | No conflict. These add detail the arch doesn't forbid, and S19 kept them in the Drizzle schema |
| `pool_members` has an `active` flag, where arch 6 lists a member `status` | Arch amended in N4 (ADR-0009 note): the owner chose `active` as the status |

## Section 7.4: invariants

| Invariant | Finding |
|---|---|
| Hard-rule breakers stop before AI | Matches. Tested in `src/domain/purchases.test.ts` |
| AI can only flag or block | Matches. All eight combinations tested in `src/domain/rules.test.ts` |
| AI failure fails safe | Matches. N2 (S28) added a test per failure type on `groq-sdk`: timeout, dropped connection, 4xx, 5xx, bad body, both rate-limit paths, quota and no key |
| Agents can't pay or edit rules | Matches. Two tools, `z.strictObject` arguments, no payment credential |
| Identity and price come from the server | Matches. Tool handlers read the `agent_runs` row, and the price comes from `products` |
| Product text is untrusted | Matches. `cleanText` strips control characters and caps length. The labeled manipulation set is S39 (I1) |
| Stale approvals are re-checked | Matches. Approval re-runs every hard rule under the pool lock |
| A pool can't be overspent, and a double approval charges once | Matches, now proven on real Postgres by `src/domain/races.test.ts` (M2) |
| Webhooks are safe to repeat | Fixed in N4 (S38). Duplicate, reordered, unmatched, contradictory and unsigned events are tested in `src/domain/webhooks.test.ts` |

## Section 8: failures and security

| Difference | Resolution |
|---|---|
| Stale `reviewing` and `capturing` are not recovered after a restart | Fixed by S41a (N4) |
| A webhook that contradicts the ledger doesn't pause the pool | Partly fixed in N4 (S38): the purchase is marked `needs_attention` and nothing moves. Pausing the pool is S45 (I2) |
| Reconciliation with PayPal's totals | Fixed by S45 (I2) |
| Same-origin check, `SameSite=Lax` cookie, sandbox-only adapter, plain-text rendering | Match |
