# Kitty Build Plan

Each step is sized for one chat. A fresh session can run any step using this file, `rules.md` and the documents the step names.

- **Requirements:** `.claude/prds/kitty.prd.md`
- **Design:** `docs/architecture.md` (referred to below as "arch")
- **Decisions:** `docs/adr.md`
- **Budget:** $0. **Deadline:** none set.

## How to run a step

1. Pick the first `pending` step in the status table whose dependencies are all `done` or `skipped`, and merged to `main`. Skip steps marked **You** unless you are helping the project owner with them.
2. Branch from `main` as `step/<id>-<short-name>`. S01 is the exception and runs on `docs/kitty-prd-architecture`.
3. On that branch, set the step to `in-progress`. Read its section and the arch sections it names.
4. Do the tasks, and stay inside the step. If it won't fit in one chat, split it (see Changing this plan).
5. Run the step's checks, the baseline checks and the rules in "After every step".
6. Set the step to `done` only if its "Done when" passed. A gate that fails is `blocked`, not `done`. Follow Changing this plan.
7. Stop and ask the owner to approve the commit, push, pull request and merge. The next step can't start until this one is on `main`.

**Status values:** `pending`, `in-progress`, `done`, `blocked` (add the reason under Change log), `skipped` (add the reason under Change log).

**Who does it:** **Agent** means a coding session does the work. **You** means the project owner must do it, because it needs their accounts, credentials or real people. **Agent + You** names the owner's part in the step.

**Credentials:** agents never enter a login, and never open or print `.env`. Scripts load it themselves. If a provider asks for a card, set the step to `blocked` and ask the owner.

**Model:** Default unless the step says **Strongest**, which marks steps that move or settle funds, and decision steps.

**Baseline checks** (from step S03 onward):

```bash
npm run lint && npm run typecheck && npm test
```

Database tests need `docker compose up -d db` first.

**Spike output:** each spike writes a sanitized summary to `docs/spike/<step-id>.md`. Raw logs go to the gitignored `.spike-logs/` folder.

**Undoing a step:** close the branch unless the step's "Undo" line says otherwise. Sandbox data needs no cleanup.

### After every step

- No secret, card number or real personal data is in the repo. The repo is public.
- No paid plan or card was added to any service.
- The payment adapter still has only the sandbox URL.
- From S20 on, only the ledger changes funds and only the purchase service starts spending. Spikes are exempt.
- Domain code (`src/domain`) imports no framework or provider SDK. The ledger uses a transaction port implemented in `src/db`.
- `plan.md` status is current.

## Status

| ID | Step | Who | Depends on | Status |
|---|---|---|---|---|
| **Phase A: Feasibility (PRD milestone 1)** | | | | |
| S01 | Put planning docs on main | Agent | none | done |
| S02 | Create free accounts and keys | You | S01, S03 | pending |
| S03 | Scaffold the app | Agent | S01 | done |
| S04 | PayPal sandbox client | Agent | S03 | done |
| S05 | Spike: authorize and partial captures | Agent + You | S02, S04 | pending |
| S06a | Spike: refund and void | Agent + You | S05 | pending |
| S06b | Spike: reauthorize | Agent + You | S05 | pending |
| S07 | Spike: webhooks and read calls | Agent + You | S06a | pending |
| S08 | **Gate:** feasibility decision | Agent + You | S06a, S06b, S07 | pending |
| S08a | Spike the token fallback (only if S08 chose it) | Agent + You | S08 | pending |
| S09 | Check AG Grid and Drizzle row locks | Agent | S03 | pending |
| S10 | Trial Groq tool calls and strict output | Agent + You | S02, S03 | pending |
| S11 | Sample Channel3 and ask about its terms | Agent + You | S02, S03 | pending |
| S11a | Record Channel3's answer | You | S11 | pending |
| S12 | Test deploy on Northflank | Agent + You | S02, S03 | pending |
| **Phase B: Product direction (PRD milestone 2)** | | | | |
| S15 | Finish competitor and PayPal research | Agent | S01 | done |
| S15a | Record the hackathon rules | Agent | S01 | pending |
| S18 | **Gate:** product direction decision | Agent + You | S15, S15a | pending |
| **Phase C: Shared pools (PRD milestone 3)** | | | | |
| S19 | Database schema and constraints | Agent | S08a, S09, S18 | pending |
| S20 | Ledger with row locks | Agent | S19 | pending |
| S21 | Hard rules | Agent | S19 | pending |
| S22 | Payment rail seam | Agent | S08a, S18 | pending |
| S23 | Demo access and owner guard | Agent | S19 | pending |
| S24 | Create and approve pools | Agent + You | S20, S22, S23 | pending |
| S25 | Members and rules | Agent | S23, S24 | pending |
| S26 | Catalog seam and marketplace | Agent | S19, S23 | pending |
| S27 | Channel3 adapter | Agent | S11a, S26 | pending |
| S28 | Model seam and Groq adapter | Agent | S10, S18, S19 | pending |
| S29 | AI purchase reviewer | Agent | S28 | pending |
| S30 | Purchase service: checks and review | Agent | S20, S21, S26, S29 | pending |
| S31 | Purchase service: reserve and capture | Agent | S22, S30 | pending |
| S32 | Member buying screens | Agent + You | S25, S31 | pending |
| S33 | Owner approval | Agent | S31 | pending |
| S34 | AG Grid owner ledger | Agent | S09, S33 | pending |
| S35 | Agent runner | Agent | S28, S31 | pending |
| S36 | Agent run screens | Agent + You | S24, S25, S34, S35 | pending |
| S37 | Close and release | Agent + You | S24, S31 | pending |
| S38 | Webhook intake | Agent | S07, S24, S31, S37 | pending |
| S39 | Labeled AI test set | Agent + You | S29, S35 | pending |
| S40 | **Gate:** milestone 3 scenarios | Agent + You | S27, S32, S34, S36, S37, S38, S39 | pending |
| **Phase D: Full-term pools (PRD milestone 4)** | | | | |
| S41a | Tick endpoint and purchase recovery | Agent | S40 | pending |
| S41b | Remaining tick jobs | Agent | S41a | pending |
| S42 | Pool term expiry | Agent | S41b | pending |
| S43 | Refunds | Agent + You | S41a | pending |
| S44 | Hold refresh | Agent + You | S41a | pending |
| S45 | Reconciliation and pause | Agent | S41a | pending |
| S46a | Fault tests: AI, catalog, agent | Agent | S42, S43, S44, S45 | pending |
| S46b | Fault tests: payments and webhooks | Agent | S42, S43, S44, S45 | pending |
| S46c | Failure screens | Agent | S46a, S46b | pending |
| S48 | Production deploy | Agent + You | S12, S46c | pending |
| S47a | **Gate, part 1:** start a full-term pool | Agent + You | S48 | pending |
| S47b | **Gate, part 2:** finish the full-term pool | Agent + You | S47a | pending |
| **Phase E: Public demo (PRD milestone 5)** | | | | |
| S49 | Judge access | Agent + You | S48 | pending |
| S50 | Polish the core screens | Agent | S47b | pending |
| S51 | Security review | Agent | S49, S50 | pending |
| S52 | README and open-source license check | Agent | S15a, S49 | pending |
| S53 | Clean-account end-to-end run | Agent + You | S51, S52 | pending |
| S53a | Start the demo pool | You | S53 | pending |
| S54 | Demo video | You | S53a | pending |
| S55 | Hackathon submission | You | S15a, S54 | pending |
| **Phase F: Nice-to-have extras** | | | | |
| E1 | Gemini adapter | Agent | S55 | pending |
| E2 | Ledger CSV export | Agent | S55 | pending |
| E3 | Accessibility and phone layout | Agent | S55 | pending |
| E4 | Guided demo and reset | Agent | S55 | pending |
| E5 | Research several real merchants | Agent | S55 | pending |
| E6 | Organization tier discovery (PRD milestone 6) | Agent | S55 | pending |

**Can run side by side:** S09, S10, S11 and S12; S15 and S15a with anything in Phase A; S22, S26 and S28; S43 and S44. These steps have no output dependency on each other, but expect small merge conflicts in `plan.md`, `package.json` and `.env.example`.

---

## Phase A: Feasibility

### S01: Put planning docs on main

**Context:** The PRD, research and architecture are on branch `docs/kitty-prd-architecture`. `docs/adr.md`, `plan.md` and `rules.md` are not committed, and the PRD and architecture have uncommitted edits. Fresh sessions branch from `main`, so they need these files there. Runs on the existing docs branch.
**Do:** With the owner's approval, commit the three new files and the PRD and architecture edits, push, and merge the branch into `main`.
**Check:** `git fetch && git ls-tree -r origin/main --name-only` lists `rules.md`, `plan.md`, `.claude/prds/kitty.prd.md` and all three of `docs/architecture.md`, `docs/adr.md`, `docs/research.md`.
**Done when:** every planning document is on `origin/main`.

### S02: Create free accounts and keys (You)

**Context:** Arch 2.1 and Security. Everything is free. Never add a card. S03 has already created `.env.example` and `.gitignore`.
**Do:**
- PayPal Developer: create a sandbox REST app, and a sandbox business and buyer account.
- Create free accounts and API keys for Groq and Channel3, and a Northflank account.
- Turn on GitHub secret scanning and push protection for the repo.
- Create `.env` from `.env.example`. Generate your own `SESSION_SECRET`, `CRON_SECRET` and `DEMO_ACCESS_CODE`. Use the local Docker `DATABASE_URL`. `PAYPAL_WEBHOOK_ID` comes in S07.

**Check:** each account shows a free plan and no payment method.
**Done when:** the keys exist locally and were never pasted into chat or the repo.

### S03: Scaffold the app

**Context:** Arch 2 and 3. Node 22.13 or newer and Docker are available locally. The repo is public and has no license. `create-next-app` refuses a folder that already has files such as `rules.md`.
**Do:**
- Scaffold Next.js App Router with TypeScript in a temporary folder, then copy it to the repo root without overwriting existing files. Use the `src/` layout from arch 3.
- Add Zod, Vitest, `tsx`, one smoke test, a `/api/health` route, and `lint`, `typecheck` and `test` scripts.
- Add `docker-compose.yml` with a `db` Postgres service.
- Add `.env.example` with every secret name from arch Security plus `AI_PROVIDER` and `CATALOG_PROVIDER`, and no values. Make `.gitignore` cover `.env*` except the example, and `.spike-logs/`.
- Add an MIT `LICENSE`, and a GitHub Actions workflow running the baseline checks.

**Check:** baseline checks pass, `npm run build` passes and `docker compose up -d db` starts.
**Done when:** a clean clone can install, build and test.

### S04: PayPal sandbox client

**Context:** Arch 2 (PayPal row), 3 (payment rail seam), 7.2. A small typed `fetch` wrapper. This is the first draft of the adapter.
**Do:**
- In `src/adapters/payments/paypal-client.ts`: token fetching with caching, and typed calls for create order, get order, authorize, get authorization, capture, get capture, void, reauthorize, refund and webhook signature verification.
- Accept a `PayPal-Request-Id` on each write. Use a hard-coded sandbox base URL with no setting for live.
- Classify every result as `succeeded`, `failed`, `unsupported` or `unknown`. Timeouts, dropped connections, 5xx and unreadable responses are `unknown`.

**Check:** `npx vitest run src/adapters/payments` with mocked `fetch` covers each classification.
**Done when:** no call can return "failed" for an unclear outcome.

### S05: Spike: authorize and partial captures (Agent + You)

**Context:** Arch Q1, Q2 and Q5. The whole product depends on this. **Your part:** approve once in the browser with the sandbox buyer.
**Do:**
- Write `scripts/spike/01-capture.ts`, run with `npx tsx`: create a $150 authorize order, print the approval link, then authorize after approval.
- Make at least three partial captures, then continue with small captures up to a set count (for example 10).
- Replay one capture with the same `PayPal-Request-Id` immediately, after an hour and on a later day if possible, and compare the results.
- Print the authorization ID for later spikes. Write the summary to `docs/spike/S05.md`.

**Check:** the captures appear in the sandbox dashboard.
**Done when:** Q1 and Q2 each have a written answer or a noted PayPal blocker, and capture replay is recorded for Q5.

### S06a: Spike: refund and void (Agent + You)

**Context:** Arch Q4, Q5 and Q6. **Your part:** approve a fresh authorization with the sandbox buyer.
**Do:**
- Write `scripts/spike/02-refund-void.ts`. On a fresh, partly captured authorization, refund one capture and check whether capacity changes.
- Replay the refund with the same request ID, void the remainder, and replay the void.
- Write the summary to `docs/spike/S06a.md`, including exact errors.

**Check:** results match the sandbox dashboard.
**Done when:** Q6 and the void part of Q4 have answers.

### S06b: Spike: reauthorize (Agent + You)

**Context:** Arch Q3 and Q4. PayPal may limit when reauthorization is allowed. **Your part:** provide a partly captured authorization ID, and approve a new one if needed.
**Do:**
- Write `scripts/spike/03-reauthorize.ts <authorization-id>`. Reauthorize, replay with the same request ID, capture on the new authorization, then void the remainder.
- Write the summary to `docs/spike/S06b.md`.

**Check:** results match the sandbox dashboard.
**Done when:** Q3 and the rest of Q4 have answers. If timing blocks it, set this step to `blocked` with the retry date.

### S07: Spike: webhooks and read calls (Agent + You)

**Context:** Arch Q7, Q5, 8. PayPal needs a public HTTPS address. Use a free tunnel. **Your part:** create the sandbox webhook pointing at the tunnel URL and put its ID in `.env`.
**Do:**
- Write `scripts/spike/webhook-receiver.ts`, which logs headers and bodies to `.spike-logs/`.
- Subscribe to the events in `project.md` and trigger them with S05 and S06a scripts.
- Record whether events identify each capture and carry `invoice_id`, and which failure event arrives.
- Verify one signature using the S04 call. Confirm a read call can total an authorization's captures.
- Write the summary to `docs/spike/S07.md`.

**Check:** the log contains capture, refund and void events.
**Done when:** Q7 is answered, one signature has been verified and captures can be totalled.

### S08: Gate: feasibility decision (Agent + You, Strongest)

**Context:** Arch 3 (payment rail seam), 9 and 10. PRD milestone 1 must pass before later work. **Your part:** confirm the path.
**Do:**
- Read `docs/spike/` and choose: authorize-and-capture, the Payment Method Tokens fallback, or stop.
- Update arch 5, 7 and 10, ADR-0003 and ADR-0006, and any `plan.md` step the results change.
- If authorize-and-capture is chosen, set S08a to `skipped`.

**Check:** every one of Q1 to Q7 in arch 10 has a recorded result or a stated workaround.
**Done when:** the owner has confirmed a path. If neither path works, set this step to `blocked` and stop the plan here.

### S08a: Spike the token fallback (Agent + You, Strongest)

**Context:** Arch 3 (payment rail seam). Runs only if S08 chose the fallback. **Your part:** request any PayPal approval it needs.
**Do:** Prove saving PayPal and charging separately in the sandbox, then revise S24, S37 and S44, which assume an authorization. Write the summary to `docs/spike/S08a.md`.
**Check:** a saved payment can be charged twice in the sandbox.
**Done when:** the fallback works. If it doesn't, set to `blocked` and stop the plan.

### S09: Check AG Grid and Drizzle row locks

**Context:** Arch Q9, 7.1. Quick checks so later steps rest on facts.
**Do:**
- Throwaway page: AG Grid Community with sample ledger rows, Approve and Deny cells, and in-place row updates by purchase ID.
- Throwaway test: two concurrent Drizzle transactions using `FOR UPDATE` on real Postgres.
- Write what worked, and any Enterprise-only feature, to `docs/spike/S09.md`.

**Check:** the lock test shows the second transaction waiting.
**Done when:** Q9 is answered and the row-lock approach is confirmed. Remove the throwaway code.

### S10: Trial Groq tool calls and strict output (Agent + You)

**Context:** Arch 2, 2.1, ADR-0005. No test of this model exists yet. Mind the 8,000 tokens-a-minute limit. **Your part:** read the free-plan limits from your Groq console.
**Do:**
- Script a two-tool call using `groq-sdk` and `openai/gpt-oss-120b`, and a separate strict JSON-schema review call.
- Record finish reasons, tokens used per turn, 429 behavior and retry headers in `docs/spike/S10.md`.

**Check:** the script ran against the live API within free limits.
**Done when:** a typical agent run's token use is known, and tool calling and strict output are confirmed or a swap is recommended.

### S11: Sample Channel3 and ask about its terms (Agent + You)

**Context:** Arch Q8, ADR-0007. Each search uses free quota, so use only a handful. No Channel3 data may be committed. **Your part:** send the question.
**Do:**
- Run at most 5 searches. Record field names and types only in `docs/spike/S11.md`, plus the number of searches used.
- Confirm whether the 1,000 free searches are one-time or monthly.
- Draft a short question to Channel3: is a sandbox checkout with no retailer order allowed, and can returned products be kept for 24 hours?

**Check:** `docs/spike/S11.md` contains no product data.
**Done when:** fields are known and the owner has sent the question.

### S11a: Record Channel3's answer (You)

**Context:** S27 waits on this.
**Do:** Record Channel3's reply in `docs/spike/S11.md`, or decide to proceed with the seeded catalog if no reply comes.
**Done when:** an answer or the owner's decision is written down.

### S12: Test deploy on Northflank (Agent + You)

**Context:** Arch Q10, ADR-0002. The free plan's CPU, memory, database size and build limits are not published. **Your part:** connect the repo and enter any values in Northflank.
**Do:**
- Add a Dockerfile if the build needs one. Deploy the scaffold with a Postgres add-on and a cron job that calls `/api/health`.
- Record the limits found, build time, memory use and whether anything sleeps in `docs/spike/S12.md`.

**Check:** the public URL responds, the cron calls appear in the logs, and no payment method was needed.
**Done when:** Q10 is answered, or the fallback in arch Q10 is chosen.
**Undo:** delete the test project.

---

## Phase B: Product direction

### S15: Finish competitor and PayPal research

**Context:** PRD open questions, `docs/research.md`. Payman, Skyfire, Crossmint, Revolut and PayPal's family features were not covered, and PayPal's own agent controls are unconfirmed.
**Do:**
- Research those products, using PayPal's own documentation for its controls.
- Add dated findings with sources to `docs/research.md`.
- State plainly whether PayPal already offers reserved, shared budgets.

**Check:** every claim has a source.
**Done when:** the PRD's competitor questions can be answered.

### S15a: Record the hackathon rules

**Context:** PRD risk "Hackathon rules conflict with the plan". Automated fetches of Devpost may fail, but the built-in browser can read https://paypalaihackathon.devpost.com/rules. If it can't, ask the owner for the text.
**Do:** Summarize the requirements, judging criteria and sponsor prize requirements in your own words in `docs/hackathon-rules.md`, and flag anything that conflicts with this plan.
**Check:** each requirement names the section of the rules it came from.
**Done when:** S52, S54 and S55 can work from that file.

### S18: Gate: product direction decision (Agent + You, Strongest)

**Context:** PRD users and hypothesis, `docs/research.md`. There are no interviews, so this is the owner's decision based on research. The owner has not yet decided which user group leads, or on four product changes: positioning as a shopping service, making agents the lead audience, rewording "reserved", and an adversarial demo moment.
**Do:**
- Combine S15 and S15a, and recommend continue, change direction or stop, and which group leads.
- Ask the owner about the four product changes, then propose any PRD edits and wait for approval.

**Check:** the recommendation cites the research.
**Done when:** the owner has decided to continue. If the owner stops or changes direction, set to `blocked` and re-plan Phases C to E, or abandon them.

---

## Phase C: Shared pools

### S19: Database schema and constraints (Strongest)

**Context:** Arch 6, 7.1. Drizzle ORM. Money is integer cents, USD only.
**Do:**
- Create all tables in arch 6 with migrations, including `usage_counters`.
- Add the check constraints in 7.1, the unique `idempotency_key` and `paypal_event_id`, and the partial unique index for one open run per agent.
- Add a `db:migrate` script, test database reset and a Postgres service in the GitHub Actions workflow.

**Check:** tests on real Postgres prove each constraint rejects bad rows, and CI passes.
**Done when:** migrations run from empty, and overspending rows are refused by the database.
**Undo:** the local database can be dropped. No shared data exists yet.

### S20: Ledger with row locks (Strongest)

**Context:** Arch 7.1, 7.3. Only this module changes funds. It must never release funds on an unknown outcome, or make a refund spendable unless the spike proved it can.
**Do:**
- Implement balance formulas in one place, in `src/domain/ledger`, using a transaction port implemented in `src/db`.
- Implement reserve, capture-settled, release, refund-completed and close, each locking the pool row and appending `ledger_entries`.

**Check:** `npx vitest run src/domain/ledger`. Includes a race test: $40 available and two $30 purchases, where exactly one succeeds. Also tests the 7.3 refund table.
**Done when:** every row of the 7.1 and 7.3 tables has a passing test.

### S21: Hard rules

**Context:** Arch 5.2 steps 2 and 4, 7.4. Pure functions with no I/O. Balances arrive as inputs.
**Do:**
- Implement the checks: pool usable, member active, store allowed, member limit and pool balance.
- Implement "strictest outcome wins". A $0 threshold means every purchase needs approval, and AI `allow` never overrides a rule.

**Check:** `npx vitest run src/domain/rules` covers every rule and every combination of rule outcome and AI decision.
**Done when:** AI output cannot loosen any outcome.

### S22: Payment rail seam (Strongest)

**Context:** Arch 3 (payment rail seam), 7.2. Uses the path chosen in S08.
**Do:**
- Define the interface: `createPoolPayment`, `confirmPoolPayment`, `charge`, `refreshHold`, `releaseHold`, `refund`, `getPoolPaymentState`, `getCapture` and `verifyWebhookSignature`.
- Build the chosen adapter on the S04 client, with the fixed request IDs from 7.2.
- Build a fake adapter whose outcomes tests can script. Set `holdsRealFunds` correctly.

**Check:** unit tests prove retries reuse the same request ID.
**Done when:** nothing outside the adapter knows PayPal details.

### S23: Demo access and owner guard

**Context:** Arch Security, Judge access. No passwords.
**Do:**
- Access code entry that creates a demo household with an owner, a teen and an agent.
- A signed httpOnly cookie with `SameSite=Lax`, a same-origin check on mutating routes, and a persona switcher.
- A server-side owner guard helper.

**Check:** tests show a teen persona is refused owner-only actions.
**Done when:** identity comes only from the server session.

### S24: Create and approve pools (Agent + You)

**Context:** Arch 5.1. Term capped at 28 days. **Your part:** one sandbox buyer approval.
**Do:**
- Pool service for `draft`, `awaiting_payer`, `active` and `abandoned` on cancel.
- The create screen, PayPal redirect, return and cancel routes, and stored authorization with `honor_ends_at` and `expires_at`.

**Check:** tests with the fake rail, then one real sandbox approval.
**Done when:** `authorized_cents` comes from PayPal's response.

### S25: Members and rules

**Context:** PRD MVP, arch 6, 5.3 and 7.3.
**Do:**
- Owner screens and routes to add and remove people and agents, and set limit, allowed stores and approval threshold.
- Refuse a limit below what is already used, and cap a raised limit by the pool's available balance.

**Check:** route tests for owner-only access, removal, the limit floor and the raise cap.
**Done when:** each member's rules are stored and guarded.

### S26: Catalog seam and marketplace

**Context:** Arch 3 (catalog seam). The seeded catalog is hand-written, with no Channel3 data in the repo.
**Do:**
- `search` and `getProduct`, chosen by `CATALOG_PROVIDER`.
- Seeded stores and products, including items that are off-goal and one with manipulative text for tests.
- A marketplace browse page. Product text renders as plain text.

**Check:** tests for store mapping and dropping products with no USD price.
**Done when:** every product has a local ID and local price.

### S27: Channel3 adapter

**Context:** Arch 3 (catalog seam), ADR-0007. Channel3 is an MVP sponsor tool. If S11a rules it out, ask the owner, who approves any PRD edit, then set this step to `skipped`.
**Do:**
- Implement search behind the seam, mapping to Kitty stores, with fallback to seeded on errors.
- Store only returned products. Count searches in `usage_counters`, starting from S11's count, and switch to seeded at 900.
- Provide the purge function for unpurchased products older than 24 hours (S41b schedules it).

**Check:** tests with hand-written synthetic fixtures matching S11's field shape. Never commit recorded responses. Test the switch at 900.
**Done when:** the free 1,000 cannot be exceeded.

### S28: Model seam and Groq adapter

**Context:** Arch 3 (model seam), 2.1, Security. Use the S10 results.
**Do:**
- `reviewPurchase` and `agentTurn`, chosen by `AI_PROVIDER`.
- One AI call at a time and retry-delay handling. Daily app-wide and per-household caps stored in `usage_counters`. An AI-off switch.
- A fake provider for tests.

**Check:** tests for pacing, caps surviving a restart and each failure type.
**Done when:** every failure returns a typed failure, never `allow`.

### S29: AI purchase reviewer

**Context:** Arch 5.2 step 3, 7.4. No tools. Strict JSON output. Product text is untrusted data.
**Do:**
- Build server-side facts, with product text truncated, stripped of control characters and passed as labeled JSON, never in the system prompt.
- Return `allow`, `flag` or `block` plus a reason.

**Check:** tests with the fake provider cover every failure leading to `needs_approval`.
**Done when:** the reviewer can't change amounts and can't default to `allow`.

### S30: Purchase service: checks and review (Strongest)

**Context:** Arch 5.2 steps 1 to 4. Uses `submitPurchase(context, productId, quantity, idempotencyKey)`.
**Do:**
- Price from `products`, hard rules in Tx A, then review with no transaction held.
- Record `rejected_by_rules`, `reviewing`, `blocked_by_ai` or `awaiting_approval`.
- A repeated key returns the same purchase.

**Check:** tests assert no reviewer call when a hard rule fails, and that a supplied price is impossible.
**Done when:** the first half of the purchase state machine in arch 6 is covered.

### S31: Purchase service: reserve and capture (Strongest)

**Context:** Arch 5.2 steps 5 to 7, 7.2. No transaction may span the PayPal call.
**Do:**
- Tx B re-runs rules and reserves. Capture happens outside a transaction. Tx C settles.
- Implement `capture_unknown` and replay with the same request ID.
- Handle a pool that is briefly `refreshing`, as arch 5.2 describes.

**Check:** fake-rail tests for success, definite failure and unknown outcomes. A race test across two purchases.
**Done when:** an unknown outcome never releases funds and a replay never uses a new ID.

### S32: Member buying screens (Agent + You)

**Context:** Arch 5.2. A person's request returns after step 2 and the page polls. **Your part:** approve a sandbox pool to buy from.
**Do:** Buy from the marketplace as a member, show live status and plain-language reasons, and show the member's remaining limit.
**Check:** in the browser, one real sandbox purchase, plus a rule-breaking purchase being stopped.
**Done when:** a teen can buy within their rules.

### S33: Owner approval (Strongest)

**Context:** Arch 5.3. Approval can't override a hard rule.
**Do:** Approve and deny routes that lock the pool, re-run every rule and continue to capture, plus expiry of waiting requests.
**Check:** one test per stale case in 5.3: balance gone, limit lowered, member removed and pool closing.
**Done when:** the captured amount always matches what the owner saw.

### S34: AG Grid owner ledger

**Context:** PRD sponsor tools, arch 4. AG Grid Community, polling every 2 to 3 seconds. Use `docs/spike/S09.md`.
**Do:** One endpoint with a row per purchase, the grid with member, amount, rule result, AI decision and status, Approve and Deny cells, and a pool balance panel.
**Check:** in the browser, rows update in place and AI reasons render as text.
**Done when:** the owner can run approvals from the ledger.

### S35: Agent runner (Strongest)

**Context:** Arch 5.7, 7.4. Only `search_products` and `request_purchase`. Member, pool and price come from the server.
**Do:**
- A manual tool loop saved to `agent_runs`, with Zod on every argument.
- Caps on turns, purchases and time, and one open run per agent.
- `runId:toolUseId` as the idempotency key.

**Check:** tests with hostile tool arguments change nothing. A tool-list test confirms exactly two tools.
**Done when:** the runner holds no payment credential or capture path.

### S36: Agent run screens (Agent + You)

**Context:** Arch 5.7. The owner starts a run and watches it. **Your part:** approve a sandbox pool.
**Do:** Start a run with a task, show its steps as plain text, and show "agent unavailable" when quota runs out.
**Check:** in the browser, one real run in the sandbox, within free limits.
**Done when:** an agent's purchase appears in the owner's ledger.

### S37: Close and release (Agent + You, Strongest)

**Context:** Arch 5.6. **Your part:** approve a sandbox pool.
**Do:** An owner-only route and button, and a resumable `advanceClosing(poolId)`. It sets `closing`, expires waiting approvals, waits for in-flight captures, voids the remainder, and sets `released_cents` and `closed`. Handle the S08 result if a void is unsupported.
**Check:** tests for each path and the owner guard, then one sandbox close.
**Done when:** PayPal and the ledger agree after closing.

### S38: Webhook intake (Strongest)

**Context:** Arch 3, 8. Use `docs/spike/S07.md`.
**Do:** Check signatures on the raw body, dedupe on `paypal_event_id`, apply forward-only changes, store unmatched events, and pause on contradictions.
**Check:** fixtures for duplicate, reordered, unmatched and contradictory events, and an unsigned event being rejected.
**Done when:** repeating any event changes nothing.

### S39: Labeled AI test set (Agent + You)

**Context:** PRD metric "AI purchase review quality", arch Q12. Runs must fit the free limits. **Your part:** agree the target.
**Do:**
- Create on-goal, off-goal and manipulation cases, including hidden text in product descriptions.
- Add a paced runner and record accuracy in `docs/ai-eval.md`.
- Propose a target. If Groq falls short, tell the owner E1 can be done sooner by changing its dependency.

**Check:** the run finishes without exceeding the daily caps.
**Done when:** there is a measured result and an owner-agreed target.

### S40: Gate: milestone 3 scenarios (Agent + You, Strongest)

**Context:** Arch 9 milestone 3, PRD success metrics. **Your part:** approve the sandbox pools the scenarios use.
**Do:** Script scenarios against the sandbox and real Postgres, including off-goal purchases, and record results in `docs/test-results.md`.
**Check:** 100% of rule-breaking purchases stopped, off-goal purchases flagged or blocked, 0 pools overspent in the race test, pool-integrity comparison recorded, one charge in the replay test, and S39 run.
**Done when:** all pass. A failure sets this to `blocked`, and a fix step is inserted before Phase D.

---

## Phase D: Full-term pools

### S41a: Tick endpoint and purchase recovery (Strongest)

**Context:** Arch 2 (scheduled work), 8. Authenticated by `CRON_SECRET`.
**Do:** `/api/internal/tick` with jobs for stale `reviewing`, stale `capturing`, `capture_unknown` replay and expired approvals. Hold no lock across a network call.
**Check:** tests for each job and for a bad secret being refused.
**Done when:** running the tick twice is safe.

### S41b: Remaining tick jobs

**Context:** Arch 5.6, 8. Builds on S41a.
**Do:** Add jobs for stale agent runs, unmatched webhooks, the product purge and `advanceClosing` retries.
**Check:** tests for each job.
**Done when:** a pool stuck in `closing` advances once its captures settle.

### S42: Pool term expiry

**Context:** Arch 5.1, 5.6.
**Do:** Close pools at term end, and mark never-approved pools `abandoned`.
**Check:** tests with a controlled clock.
**Done when:** no pool stays open past its term.

### S43: Refunds (Agent + You, Strongest)

**Context:** Arch 5.4, 7.3. Whole-purchase refunds, owner only, including on closed pools. **Your part:** approve a sandbox pool.
**Do:** An owner-only route and ledger button, `refund_pending` through `refunded`, a tick job replaying unknown outcomes, and "refunded, limit stays used". Apply `docs/spike/S06a.md`.
**Check:** the 7.3 table, the owner guard and a closed-pool refund pass, plus one sandbox refund.
**Done when:** refunded money is not offered as spendable, unless S08 proved otherwise.

### S44: Hold refresh (Agent + You, Strongest)

**Context:** Arch 5.5, Q3. Depends on `docs/spike/S06b.md`. **Your part:** approve a sandbox pool.
**Do:** A tick job for pools nearing `honor_ends_at` and an owner-triggered route. Skip if a capture is in flight, replay an unknown `refreshing` outcome, save the linked authorization, and show "hold needs refreshing" on failure.
**Check:** fake-rail tests for each outcome and the owner guard, then one sandbox refresh if PayPal allows it.
**Done when:** captures always use the current authorization.

### S45: Reconciliation and pause (Strongest)

**Context:** Arch 8. Produces the PRD's pool-integrity number.
**Do:** A tick job comparing captured totals with PayPal through `getPoolPaymentState`, pause on mismatch, and a small admin script to settle by hand.
**Check:** a test with a forced mismatch.
**Done when:** a disagreement freezes the pool rather than repairing it automatically.

### S46a: Fault tests: AI, catalog, agent

**Context:** Arch 8 rows for AI failure, AI quota, Channel3 and the process dying during review.
**Do:** Add fault-injection tests in `tests/faults/`, and fix anything that doesn't end in its documented state.
**Check:** `npx vitest run tests/faults`.
**Done when:** each of those rows has a passing test.

### S46b: Fault tests: payments and webhooks (Strongest)

**Context:** Arch 8 rows for capture, process death during capture, reauthorize, void and webhooks.
**Do:** Add fault-injection tests in `tests/faults/`, and fix anything that doesn't end in its documented state.
**Check:** `npx vitest run tests/faults`.
**Done when:** each of those rows has a passing test.

### S46c: Failure screens

**Context:** Arch 8. Every failure needs a visible, plain-language result.
**Do:** Add owner and member messages for each state in arch 8, including "hold needs refreshing", "AI review unavailable" and paused pools.
**Check:** in the browser, walk through each state using the fake adapters.
**Done when:** every arch 8 row has a visible result.

### S48: Production deploy (Agent + You)

**Context:** Arch 2, ADR-0002, `docs/spike/S12.md`. The free plan has one database, so reuse or delete the S12 project. **Your part:** enter secrets in Northflank and register the production webhook in PayPal.
**Do:** Deploy the app, run migrations as a host job so no agent handles the production `DATABASE_URL`, and schedule the tick. Add no card. If S12 chose the fallback, use arch Q10.
**Check:** the hosted app passes a sandbox purchase and receives its webhook.
**Done when:** the URL is stable and the tick is running.

### S47a: Gate, part 1: start a full-term pool (Agent + You)

**Context:** Arch 9 milestone 4. Runs on the hosted app. **Your part:** approve the pool.
**Do:** Create a pool, spend from it, and note its start date in `docs/test-results.md`.
**Check:** the first purchases appear in the ledger and PayPal.
**Done when:** the pool is active. S47b can run once 3 days have passed.

### S47b: Gate, part 2: finish the full-term pool (Agent + You)

**Context:** Arch 9 milestone 4. Run this after the honor period has passed. **Your part:** confirm the results in the sandbox dashboard.
**Do:** Spend again, refresh the hold, refund a purchase, close the pool and record the results and pool-integrity comparison in `docs/test-results.md`.
**Check:** the pool is usable after the honor period and the ledger matches PayPal.
**Done when:** the gate passes. A failure sets this to `blocked`, and a fix step is inserted.

---

## Phase E: Public demo

### S49: Judge access (Agent + You)

**Context:** Arch Security, Judge access. **Your part:** fill in the access code and sandbox login outside the repo.
**Do:** Configure the S28 caps for shared use, and write `docs/judge-notes.template.md` with placeholders only. Add a query for the PRD's delegation follow-through metric: the share of demo households that created a pool and added a member.
**Check:** a fresh visitor can reach a working household with only the access code.
**Done when:** a judge needs no real account.

### S50: Polish the core screens

**Context:** PRD MVP. Design is an equal judging area. Use the wording the S18 decision settled on.
**Do:** For pool creation, marketplace, purchase status, owner ledger, agent run and close, add clear empty, loading and error states, and consistent wording for money states.
**Check:** a browser walk-through of those six screens in each state. Search the code for any simulated or hard-coded result.
**Done when:** the full flow reads clearly without explanation.

### S51: Security review (Strongest)

**Context:** Arch Security, 7.4.
**Do:** Review routes, secrets, raw-body signature checks, plain-text rendering of untrusted content and the agent's tool limits. Scan git history for secrets. Report findings in chat, not in the public repo, and insert a fix step for each high-severity finding.
**Check:** every finding has a severity and a next action.
**Done when:** the review is complete and its fix steps are in this plan. S53 can't start until they are `done`.

### S52: README and open-source license check

**Context:** `docs/hackathon-rules.md`.
**Do:** Write the README: what Kitty is, setup from a clean clone, sandbox accounts and the AI tools and third-party services used. Confirm GitHub detects the license.
**Check:** `gh repo view om8P/Kitty --json licenseInfo` shows MIT.
**Done when:** someone new could run it from the README alone.

### S53: Clean-account end-to-end run (Agent + You)

**Context:** The hackathon needs a working demo shown as it really works. **Your part:** act as the sandbox buyer.
**Do:** Follow the README and judge path from scratch and run the complete flow. Log any defect.
**Check:** every step in the PRD's MVP works on the hosted URL.
**Done when:** no blocking defect remains.

### S53a: Start the demo pool (You)

**Context:** A real hold refresh can only be shown more than 3 days after a pool starts.
**Do:** Create and approve the pool for the video.
**Done when:** the pool is active and at least 3 days have passed.

### S54: Demo video (You)

**Context:** `docs/hackathon-rules.md`. Under 3 minutes, public on YouTube, and showing only working flows. An agent can draft a script from the demo moments in `docs/research.md`.
**Do:** Record and upload.
**Done when:** the public link works.

### S55: Hackathon submission (You)

**Context:** `docs/hackathon-rules.md`. An agent can draft the text, including the AI tools used. Put the access code only in a judges-only field, or confirm how to share it privately.
**Do:** Review the draft and submit on Devpost.
**Done when:** the submission is confirmed.

---

## Phase F: Nice-to-have extras

These come after the submission.

### E1: Gemini adapter

**Context:** Arch 3 (model seam), Q12. The first swap if Groq falls short. Its free-tier content is used to improve Google's products, so send demo data only.
**Do:** Add an adapter behind `AI_PROVIDER`, then re-run the S39 test set.
**Check:** the same seam tests pass for both providers.
**Done when:** the two can be compared.

### E2: Ledger CSV export

**Context:** Arch Q9. Use only what AG Grid Community includes.
**Do:** Add an owner-only CSV export of the ledger.
**Check:** the export matches the grid.
**Done when:** the file opens correctly.

### E3: Accessibility and phone layout

**Context:** Family members will mostly use phones.
**Do:** Check keyboard use, labels and contrast, and make member screens work at phone width.
**Check:** an accessibility review with no serious findings.
**Done when:** the core member flow works on a phone.

### E4: Guided demo and reset

**Context:** Helps judges see the blocked-purchase moments quickly.
**Do:** Add a short guided path and a button that resets a demo household's non-PayPal data.
**Check:** a reset affects only that household.
**Done when:** a judge can follow the path unaided.

### E5: Research several real merchants

**Context:** PRD open question. Research only. Payouts and outside merchants stay out of scope.
**Do:** Investigate separate per-merchant payments under one approval, or a PayPal platform setup, and write up the findings.
**Check:** sources come from PayPal's documentation.
**Done when:** the PRD's question can be answered.

### E6: Organization tier discovery (PRD milestone 6)

**Context:** PRD: roadmap only, and needs are unknown.
**Do:** Research what organizations need from public sources, and write up their needs and packaging ideas. If the owner wants to build it, insert new steps here.
**Check:** every claim has a source.
**Done when:** the owner decides whether to build it.

---

## Not in this plan

The PRD rules these out: live payments, spending at outside merchants, seller payouts and a native app. Live payments would first need the legal question in the PRD answered.

## Changing this plan

- **Split:** replace a step with `S20a`, `S20b` and keep its dependencies.
- **Insert:** add a step with a suffix, such as `S31a`, and update dependencies.
- **Skip or block:** set the status and add the reason below.
- **Reorder:** only if the dependency column stays true.
- **Abandon:** at a gate, set remaining steps to `skipped` and record why.

Every change gets one line in the Change log.

## Change log

| Date | Change | Reason |
|---|---|---|
| 2026-11-10 | Plan created and revised after adversarial review | From the PRD and architecture |
| 2026-11-10 | Removed S13, S14, S16, S17 and S46d, and made S18 the owner's decision | The owner removed the interviews, and the prototype existed only for them |
| 2026-11-10 | S01 also commits the PRD and architecture edits | Both had uncommitted edits that this plan depends on |
| 2026-11-10 | S03 sets Node 22.13 as the minimum and adds the design tokens and fonts | Vitest 5 needs Node 22.12 or newer and ESLint 10 needs 22.13 or newer, and no later step owned the tokens |
