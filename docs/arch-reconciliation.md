# Code and architecture reconciliation (M5)

Run on 2026-11-11, at the end of N1, against `main` plus the N1 branch (`session/N1-land-harden`). It compares `src/`, `package.json`, the `Dockerfile` and `.github/workflows/` with `docs/architecture.md` sections 2, 3, 5, 6, 7.4 and 8. Each difference is marked **fixed by step X** (the step that changes the code to match the arch), **fixed in N1** (already done), or **arch amended** (the arch now matches the code, with its ADR). Run it again at the end of N2 and of I1. After I1 no difference should remain.

## Section 2: technology

| Difference | Resolution |
|---|---|
| Raw `pg` SQL and startup `CREATE TABLE`, not Drizzle with SQL-first migrations | Fixed by S19 (N2) |
| Plain `fetch` to Groq, not `groq-sdk` | Fixed by S28 (N2) |
| Review uses `json_object` plus Zod, not strict JSON-schema output | Fixed by S29a (N2), or an ADR exception if S10 shows the model can't do it |
| Tests ran on in-memory PGlite, not real Postgres | Fixed in N1 (M2): every database test runs on the Docker Postgres, also in CI |
| The app fell back to PGlite with no `DATABASE_URL` | Fixed in N1 (M3): the app refuses to start without it |
| `schedule.yml` calls `/api/health`, not the tick | Fixed by S41a (N4), as arch 2 already says |

## Section 3: parts and seams

| Difference | Resolution |
|---|---|
| A simulated payment rail was reachable from the app | Fixed in N1 (M3): no keys means an `unconfigured` rail that refuses every call, and the scripted rail lives only in the test helpers |
| Ledger SQL sits inside the purchase and pool services, not a ledger module | Fixed by S20 (I1) |
| Rail lacks `verifyWebhookSignature`, `getCapture` and `holdsRealFunds` | Fixed by S22 with S38 (N4) |
| Rail lacks `refreshHold` and `getPoolPaymentState` | Fixed by S44 (I3) and S45 (I2) |
| No webhook handler | Fixed by S38 (N4) |
| `src/jobs` is empty: no tick jobs | Fixed by S41a (N4), S41b, S42 and S45 (I2), S44 (I3) |
| Model seam is one `Model` chat interface, not `reviewPurchase` and `agentTurn`, and `AI_PROVIDER` is unused | Arch amended (ADR-0009) |
| Catalog seam is `search` and `featured`, not `search` and `getProduct` | Arch amended (ADR-0009) |
| Model seam has only an app-wide daily cap, with no per-household cap or AI-off switch | Fixed by S49 (N6) |

## Section 5: flows

| Difference | Resolution |
|---|---|
| Agent runs cap turns and purchase requests but have no wall-clock cap (5.7) | Fixed by S28 (N2), added to that step by M5 |
| No `honor_ends_at`, so a hold past its honor period gets no warning (5.1, 5.2) | Fixed by S19 (`authorizations` table, N2) and S44 (I3) |
| No hold refresh (5.5) | Fixed by S44 (I3) |
| Pools the owner never approves are not marked `abandoned` by a timeout (5.1) | Fixed by S41a (N4) |
| Waiting approvals don't expire after a set time, only when the pool closes (5.3) | Fixed by S41a (N4), with `approval_expires_at` from S19 |
| Unknown refund outcomes are not replayed by the tick (5.4) | Fixed by S43 (I2) |
| A pool stuck in `closing` is retried only when the owner closes again (5.6) | Fixed by S41b (I2) |
| Members can't be edited after the pool is created | Fixed by S25 (N4) |

## Section 6: data model and states

| Difference | Resolution |
|---|---|
| Allowed stores in a JSONB column, not `stores` and `member_stores` | Fixed by S19 (N2) |
| No `authorizations` table. The current hold is a column on `pools` | Fixed by S19 (N2) |
| No `refunded_cents` on `pool_members`, and no `needs_attention`, `approval_expires_at` or `decided_by` on `purchases` | Fixed by S19 (N2) |
| No `webhook_events` table | Fixed by S38 (N4) |
| `usage_counters` has no scope (app or household) | Fixed by S49 (N6) |
| Pool states lack `refreshing` and `paused` | Fixed by S44 (I3) and S45 (I2) |
| `ledger_entries` also has an `authorize` kind | Arch amended (ADR-0009) |
| `pools` has extra columns (`rail`, `requested_cents`, `term_days`, `note`) and `agent_runs` keeps turns inside `steps` | No conflict. These add detail the arch doesn't forbid, and S19 keeps them in the Drizzle schema |

## Section 7.4: invariants

| Invariant | Finding |
|---|---|
| Hard-rule breakers stop before AI | Matches. Tested in `src/domain/purchases.test.ts` |
| AI can only flag or block | Matches. All eight combinations tested in `src/domain/rules.test.ts` |
| AI failure fails safe | Matches for the failures the `fetch` wrapper sees. S28 adds a test per failure type |
| Agents can't pay or edit rules | Matches. Two tools, `z.strictObject` arguments, no payment credential |
| Identity and price come from the server | Matches. Tool handlers read the `agent_runs` row, and the price comes from `products` |
| Product text is untrusted | Matches. `cleanText` strips control characters and caps length. The labeled manipulation set is S39 (I1) |
| Stale approvals are re-checked | Matches. Approval re-runs every hard rule under the pool lock |
| A pool can't be overspent, and a double approval charges once | Matches, now proven on real Postgres by `src/domain/races.test.ts` (M2) |
| Webhooks are safe to repeat | Fixed by S38 (N4) |

## Section 8: failures and security

| Difference | Resolution |
|---|---|
| Stale `reviewing` and `capturing` are not recovered after a restart | Fixed by S41a (N4) |
| A webhook that contradicts the ledger doesn't pause the pool | Fixed by S38 (N4) and S45 (I2) |
| Reconciliation with PayPal's totals | Fixed by S45 (I2) |
| Same-origin check, `SameSite=Lax` cookie, sandbox-only adapter, plain-text rendering | Match |
