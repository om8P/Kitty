# Kitty Build Plan (v2)

This is the second version of the plan. The original is kept unchanged in `v1/plan.md`. Version 2 starts from the working MVP on branch `step/mvp-demo-flow` and finishes the build to the design in `docs/architecture.md`. Each step is sized for one chat. A fresh session can run any step using this file, `rules.md` and the documents the step names.

- **Requirements:** `.claude/prds/kitty.prd.md`
- **Design:** `docs/architecture.md` (referred to below as "arch")
- **Decisions:** `docs/adr.md`
- **Original plan:** `v1/plan.md`
- **Budget:** $0. **Deadline:** Nov 12, 2026, 12:00 pm Pacific (hackathon submission, `docs/hackathon-rules.md`).

## What changed from v1

- **The MVP is the baseline.** Most of Phase C already exists in code with 413 passing tests. Those steps now say what the MVP built (**MVP status**) and list only what is left. Step IDs are unchanged, so references in `rules.md` and the docs still work.
- **Phase M is new.** It lands the MVP, proves its race safety on real Postgres, removes simulated payments from the app, and checks the built flows against the real sandbox.
- **Gates S08 and S18 no longer block the build.** S08 is recorded as authorize-and-capture, citing `docs/spike/S05.md`. S18 must be decided before S50, not before Phase C.
- **A "When" column splits the work around the deadline.** `D` is before the submission. `P` is after it. The path to submission is shorter than in v1: S40 runs on the scenarios that need no AI test set, S48 follows S41a, and S41b to S46c wait.
- **Steps are bundled into 14 sessions.** Eight necessary sessions (N1 to N8) cover everything to the submission, and six improvement sessions (I1 to I6) follow. Step sections are unchanged and become the detail for each session.
- **`docs/architecture.md` is the design, and it may change when that is the better choice.** The owner allows flexibility, as with the move from Northflank to Render and Supabase (ADR-0002, connected in S12). For the technology choices where the MVP differs, the owner decided on 2026-11-11 to keep the architecture's original choices. Each difference is fixed in the code, and nothing is left unrecorded. M5 (in N1) checks that. The known deviations, and the step that fixes each:
  - Raw `pg` SQL and startup `CREATE TABLE`, not Drizzle with SQL-first migrations (arch 2). S19, in N2.
  - Plain `fetch` to Groq, not the `groq-sdk` package (arch 2). S28, in N2.
  - Allowed stores in a JSONB column, not `stores` and `member_stores` tables (arch 6). S19, in N2.
  - Review uses `json_object`, not strict JSON-schema output (arch 2). S29a, in N2. If S10 shows the model can't do it, record an exception in an ADR instead.
  - Ledger SQL inside the purchase and pool services, not a ledger module (arch 3). S20, in I1.
  - Tests and the app's fallback use in-memory PGlite, but arch 2 says Vitest on real Postgres. M2 and M3, in N1.
  - A simulated payment rail reachable from the app. M3, in N1.
  - Tables, states and rail methods the arch lists but the MVP lacks. S19, S22, S38, S44 and S45.

  Everything on this list is fixed before the Nov 12 submission except the inline ledger SQL, which S20 moves in I1. That one changes how the code is built, not what it does.

## How to run a session

Work runs in **sessions**, not single steps. A session bundles several steps that belong together (see Sessions below). There are 8 necessary sessions (N1 to N8) and 6 improvement sessions (I1 to I6). Do the necessary ones first, in order, then the improvements.

**Starting a session.** The owner can start any session with one line, such as "read the md files and start the session". Follow "Starting a session" in `rules.md`: find the next session yourself (step 1 below), say which one it is in two lines, ask only the questions in that session's brief under "Session briefs", then run it. The owner does not need to name the session, its steps or its branch.

1. Pick the first session in the Sessions tables whose "Starts when" condition is met and whose earlier sessions are merged to `main`. Do not start an `I` session before N8 is done, unless time is left before the deadline and the table allows it.
2. Use the branch named in the session's brief (`session/<id>-<short-name>`, cut from `main`). One session per branch and pull request. N1 is the exception: it works on the existing MVP branch, `step/mvp-demo-flow`. A session that is already part-done keeps its branch: look for `session/<id>-*` before making a new one.
3. Set the session's steps to `in-progress` as you reach them. Read each step's section and the arch sections it names.
4. Do the steps in the listed order, and stay inside the session. Commit once per step, with the step ID in the message, so the history stays reviewable. If the session won't fit in one chat, split it at a step boundary (see Changing this plan).
5. After each step, run its checks and the baseline checks. At the end, run the rules in "After every step".
6. Set a step to `done` only if its "Done when" passed. If one fails, set it to `blocked` with the reason, skip the steps that depend on it, finish the rest, and say so in the pull request. A gate that fails stops the session.
7. Update `plan.md` statuses, then stop and ask the owner to approve the commit, push, pull request and merge. The next session can't start until this one is on `main`.

**Status values:** `pending`, `in-progress`, `done`, `blocked` (add the reason under Change log), `skipped` (add the reason under Change log). `in-progress` on a step marked **MVP status** means the MVP built part of it and the rest is still to do.

**When:** `D` means the step is on the path to the Nov 12 submission. `P` means it comes after. If time is left before the deadline, take `P` steps in status-table order.

**Who does it:** **Agent** means a coding session does the work. **You** means the project owner must do it, because it needs their accounts, credentials or real people. **Agent + You** names the owner's part in the step.

**Credentials:** agents never enter a login, and never open or print `.env`. Scripts load it themselves. If a provider asks for a card, set the step to `blocked` and ask the owner.

**Model:** Default unless the step says **Strongest**, which marks steps that move or settle funds, and decision steps.

**Baseline checks:**

```bash
npm run lint && npm run typecheck && npm test
```

Database tests need `docker compose up -d db` first. From step M2 on, the race tests run against that Docker database.

**Spike output:** each spike writes a sanitized summary to `docs/spike/<step-id>.md`. Raw logs go to the gitignored `.spike-logs/` folder.

**Undoing a step:** close the branch unless the step's "Undo" line says otherwise. Sandbox data needs no cleanup.

### After every step

- No secret, card number or real personal data is in the repo. The repo is public.
- No paid plan or card was added to any service.
- The payment adapter still has only the sandbox URL.
- Only the ledger changes funds and only the purchase service starts spending. The MVP keeps its ledger SQL inside the purchase and pool services until S20 moves it, so S20 is the step that makes this rule true. Spikes are exempt.
- Domain code (`src/domain`) imports no framework or provider SDK. The ledger uses a transaction port implemented in `src/db`.
- No payment can be approved without PayPal. The simulated rail is for tests only (from M3).
- `plan.md` status is current.

## Status

| ID | Step | Who | Depends on | Status | When | Session |
|---|---|---|---|---|---|---|
| **Phase A: Feasibility (PRD milestone 1)** | | | | | | |
| S01 | Put planning docs on main | Agent | none | done | |  |
| S02 | Create free accounts and keys | You | S01, S03 | done | |  |
| S03 | Scaffold the app | Agent | S01 | done | |  |
| S04 | PayPal sandbox client | Agent | S03 | done | |  |
| S05 | Spike: authorize and partial captures | Agent + You | S02, S04 | done | |  |
| S06a | Spike: refund and void | Agent + You | S05 | pending | D | N3 |
| S06b | Spike: reauthorize | Agent + You | S05 | blocked | P | I3 |
| S07 | Spike: webhooks and read calls | Agent + You | S06a | pending | D | N3 |
| S08 | **Gate:** record the feasibility decision | Agent + You | S05 | pending | D | N1 |
| S08a | Spike the token fallback (only if S08 chose it) | Agent + You | S08 | pending | D | N1 |
| S09 | Check AG Grid and Drizzle row locks | Agent | S03 | done | |  |
| S10 | Trial Groq tool calls and strict output | Agent + You | S02, S03 | pending | D | N2 |
| S11 | Sample Channel3 and ask about its terms | Agent + You | S02, S03 | done | |  |
| S11a | Record Channel3's answer | You | S11 | pending | D | N3 |
| S12 | Test deploy on Render and Supabase | Agent + You | S02, S03 | done | |  |
| **Phase B: Product direction (PRD milestone 2)** | | | | | | |
| S15 | Finish competitor and PayPal research | Agent | S01 | done | |  |
| S15a | Record the hackathon rules | Agent | S01 | done | |  |
| S18 | **Gate:** product direction decision | Agent + You | S15, S15a | pending | D | N1 |
| **Phase M: Adopt the MVP (new in v2)** | | | | | | |
| M1 | Land the MVP and sync this plan | Agent + You | S08 | pending | D | N1 |
| M2 | Move tests to real Postgres and add race tests | Agent | M1 | pending | D | N1 |
| M3 | Remove simulated payments and PGlite from the app | Agent | M1 | pending | D | N1 |
| M4 | Walk the built flows against the PayPal sandbox | Agent + You | M1, M3, S06a | pending | D | N3 |
| M5 | Reconcile the code and the architecture | Agent | M1 | pending | D | N1 |
| **Phase C: Shared pools (PRD milestone 3), MVP built** | | | | | | |
| S19 | Drizzle schema, migrations and the missing tables | Agent | M1, M2 | in-progress | D | N2 |
| S20 | Ledger module | Agent | M2 | in-progress | P | I1 |
| S21 | Hard rules | Agent | S19 | done | |  |
| S22 | Payment rail seam | Agent | S08 | in-progress | D | N4 |
| S23 | Demo access and owner guard | Agent | S19 | done | |  |
| S24 | Create and approve pools | Agent + You | S23 | in-progress | D | N3 |
| S25 | Members and rules | Agent | S19, S23, S24 | in-progress | D | N4 |
| S26 | Catalog seam and marketplace | Agent | S19, S23 | done | |  |
| S27 | Channel3 adapter | Agent | S11a, S26 | in-progress | D | N4 |
| S28 | Model seam and Groq adapter | Agent | S10, S19 | in-progress | D | N2 |
| S29 | AI purchase reviewer | Agent | S28 | done | |  |
| S29a | Strict review schema | Agent | S10, S29 | pending | D | N2 |
| S30 | Purchase service: checks and review | Agent | S20, S21, S26, S29 | done | |  |
| S31 | Purchase service: reserve and capture | Agent | S22, S30 | done | |  |
| S32 | Member buying screens | Agent + You | S31 | in-progress | D | N3 |
| S33 | Owner approval | Agent | S31 | done | |  |
| S34 | AG Grid owner ledger | Agent | S09, S33 | in-progress | D | N3 |
| S35 | Agent runner | Agent | S28, S31 | done | |  |
| S36 | Agent run screens | Agent + You | S24, S34, S35 | in-progress | D | N3 |
| S37 | Close and release | Agent + You | S24, S31 | in-progress | D | N3 |
| S38 | Webhook intake | Agent | S07, S19, S24, S31, S37 | pending | D | N4 |
| S39 | Labeled AI test set | Agent + You | S29, S35 | pending | P | I1 |
| S40 | **Gate:** milestone 3 scenarios | Agent + You | M2, M4, S27, S32, S34, S36, S37, S38, S41a | pending | D | N5 |
| **Phase D: Full-term pools (PRD milestone 4)** | | | | | | |
| S41a | Tick endpoint and purchase recovery | Agent | M2, S38 | pending | D | N4 |
| S41b | Remaining tick jobs | Agent | S41a | pending | P | I2 |
| S42 | Pool term expiry | Agent | S41b | pending | P | I2 |
| S43 | Refunds | Agent + You | S41a | in-progress | P | I2 |
| S44 | Hold refresh | Agent + You | S41a, S06b, S19 | pending | P | I3 |
| S45 | Reconciliation and pause | Agent | S41a, S19 | pending | P | I2 |
| S46a | Fault tests: AI, catalog, agent | Agent | S42, S43, S44, S45 | pending | P | I4 |
| S46b | Fault tests: payments and webhooks | Agent | S42, S43, S44, S45 | pending | P | I4 |
| S46c | Failure screens | Agent | S46a, S46b | pending | P | I4 |
| S48 | Production deploy | Agent + You | S12, S41a | pending | D | N5 |
| S47a | **Gate, part 1:** start a full-term pool | Agent + You | S48 | pending | D | N5 |
| S47b | **Gate, part 2:** finish the full-term pool | Agent + You | S47a, S44 | pending | P | I3 |
| **Phase E: Public demo (PRD milestone 5)** | | | | | | |
| S49 | Judge access | Agent + You | S48 | pending | D | N6 |
| S50 | Polish the core screens | Agent | S18, S47a | pending | D | N6 |
| S51 | Security review | Agent | S49, S50 | pending | D | N6 |
| S52 | README and open-source license check | Agent | S15a, S49 | pending | D | N7 |
| S53 | Clean-account end-to-end run | Agent + You | S51, S52 | pending | D | N7 |
| S53a | Start the demo pool | You | S53 | pending | D | N7 |
| S54 | Demo video | You | S53a | pending | D | N8 |
| S55 | Hackathon submission | You | S15a, S54 | pending | D | N8 |
| **Phase F: Nice-to-have extras** | | | | | | |
| E1 | Gemini adapter | Agent | S55 | pending | P | I5 |
| E2 | Ledger CSV export | Agent | S55 | pending | P | I5 |
| E3 | Accessibility and phone layout | Agent | S55 | pending | P | I5 |
| E4 | Guided demo and reset | Agent | S55 | pending | P | I5 |
| E5 | Research several real merchants | Agent | S55 | pending | P | I6 |
| E6 | Organization tier discovery (PRD milestone 6) | Agent | S55 | pending | P | I6 |

## Sessions

The steps above are bundled into 14 sessions. Each step keeps its own section below, with its Context, Do, Check and Done when. A session is a list of those steps run in one chat, on one branch, with one pull request. The "Session" column in the status table says which session owns each step. Steps already `done` belong to none.

### Necessary sessions (do these first)

Together they cover everything on the path to the Nov 12 submission. Run them in order.

| Session | Name | Steps, in order | Who | Model | What you do in it | Done when |
|---|---|---|---|---|---|---|
| **N1** | Land and harden the MVP | S08, S08a, S18, M1, M2, M3, M5 | Agent + You | Strongest | Make two decisions up front: confirm authorize-and-capture (S08), and decide which user group leads and the four product changes (S18). Then approve the pull request | The MVP, this plan, the whole test suite on real Postgres with the race tests, the removal of simulated payments and PGlite, and the written M5 list are on `main` |
| **N2** | Align with the architecture | S19, S10, S28, S29a | Agent + You | Strongest | Read your Groq free-plan limits from the Groq console (S10), and approve the pull request | The app uses Drizzle with SQL-first migrations, the `stores`, `member_stores` and other missing tables exist, and the existing tests pass unchanged. The model seam uses `groq-sdk`. Groq tool use and strict output are trialled, and the reviewer uses strict schema (or the exception is in an ADR) |
| **N3** | Live sandbox check | S06a, S07, S11a, M4, then close S24, S34, S32, S36, S37 | Agent + You | Strongest | Be present. Approve each sandbox authorization as the buyer, start a free tunnel and create the sandbox webhook, put `PAYPAL_WEBHOOK_ID` in `.env`, and record Channel3 reply or choose the seeded catalog | Every built money flow ran against the real sandbox, on the code from N2, and matched its dashboard. S24, S32, S34, S36 and S37 are `done`, the results are in `docs/test-results.md`, and the spike notes are in `docs/spike/` |
| **N4** | Finish the build | S22 (remaining methods), S25, S27, S38, S41a | Agent | Strongest | Approve the pull request | Members are editable, webhooks are verified and idempotent, the tick runs and recovers stuck captures, and the Channel3 quota check is in place |
| **N5** | Gate and deploy | S40, S48, S47a | Agent + You | Strongest | Approve the sandbox pools the scenarios use. Enter the production secrets in Render and GitHub (the Render service and Supabase project already exist from S12), register the production webhook in PayPal, and approve the hosted pool | The scenarios pass, the hosted URL returns `db: "ok"` and `dbTls: "verified"`, a sandbox purchase and its webhook work, and the demo pool is active |
| **N6** | Judge access, polish and security | S49, S50, S51 | Agent + You | Strongest | Put the access code and sandbox login outside the repo, and review the polished screens | A fresh visitor reaches a working household with the access code, and every high-severity security finding is fixed |
| **N7** | Release readiness | S52, S53, S53a | Agent + You | Default | Act as the sandbox buyer for the clean-account run, then create and approve the pool for the video | The README alone runs the project, no blocking defect remains, and the video pool is active |
| **N8** | Video and submission | S54, S55 | You | Default | Record and upload the video, review the drafted text, and submit on Devpost. The agent drafts the script and the submission text beforehand | The submission is confirmed |

### Improvement sessions (do these after N8)

Take them in this order. If time is left before the deadline, I1 may start after N5, and nothing else may.

| Session | Name | Steps, in order | Who | Model | Starts when | Done when |
|---|---|---|---|---|---|---|
| **I1** | Ledger module and AI test set | S20, S39 | Agent + You | Strongest | N8 is done (or N5, if time is left) | Only the ledger module changes funds, the labeled test set has a measured result and an agreed target, and a second run of the M5 check finds no difference from the arch |
| **I2** | Long-term pool reliability | S41b, S42, S43, S45 | Agent + You | Strongest | N5 is done | The remaining tick jobs run, pools close at term end, refunds replay safely, and a disagreement with PayPal freezes the pool |
| **I3** | Hold refresh and the full-term gate | S06b, S44, S47b | Agent + You | Strongest | N5 is done, 2026-11-13T07:46Z has passed, and the S47a pool is more than 3 days old | A pool stays usable past the honor period and the ledger matches PayPal |
| **I4** | Fault tests and failure screens | S46a, S46b, S46c | Agent | Strongest | I2 and I3 are done | Every failure row in arch 8 has a passing test and a visible message |
| **I5** | Extras: build | E1, E2, E3, E4 | Agent | Default | N8 is done | Gemini adapter, CSV export, accessibility and phone layout, and the guided demo with reset all work |
| **I6** | Extras: research | E5, E6 | Agent | Default | N8 is done | The PRD merchant and organization questions can be answered |

**Rules inside a session:**

- A session is Strongest if any of its steps is. Mixed sessions use the stronger model throughout.
- Likely split points if a session won't fit in one chat: N2 after S19, N4 after S38, N5 after S40, I2 after S43.
- Expect small merge conflicts in `plan.md`, `package.json` and `.env.example` between a session and an `I` session started alongside it. Update `plan.md` at the end of each session, not mid-way.

### Session briefs

What a session needs beyond its steps. Every session also follows `rules.md` ("Starting a session" and the hard rules). "Ask first" lists the questions to put to the owner in one batch, before any work. If the owner is not available for one of them, stop and say so.

| Session | Branch | Ask first | Notes |
|---|---|---|---|
| **N1** | `step/mvp-demo-flow` (fetch it from `origin`) | 1. Confirm authorize-and-capture as the path (S08; evidence `docs/spike/S05.md`). 2. Which user group leads, and the four product changes (S18) | Merge the latest `main` in first; if `plan.md` conflicts, take `main`'s version. Record the S08 and S18 decisions in `docs/adr.md`. Database tests need `docker compose up -d db`. M5 writes the list of differences between the code and the arch |
| **N2** | `session/N2-architecture` | Your Groq free-plan limits, read from the Groq console (S10) | The existing tests must pass unchanged, and migrations must work from empty and from an MVP-made database. For S29a, ask before recording an ADR exception for strict schema. Stay inside the Groq free limits |
| **N3** | `session/N3-sandbox-check` | Are you present now? You are needed for each sandbox approval, the tunnel and webhook, and Channel3's reply (S11a) | Ask for each approval as it is needed. Tell the owner when to put `PAYPAL_WEBHOOK_ID` in `.env`. Record results in `docs/test-results.md`, `docs/spike/S06a.md` and `docs/spike/S07.md`, with no secrets or account details. Fix any mismatch with the PayPal dashboard before closing the steps |
| **N4** | `session/N4-finish-build` | Nothing | S22: only the remaining methods (`verifyWebhookSignature`, `getCapture`, `holdsRealFunds`). Money rules apply: no transaction spans a PayPal or AI call, and an unclear outcome never releases funds. Use synthetic fixtures only. S38 needs tests for duplicate, reordered, unmatched, contradictory and unsigned events. S41a uses `CRON_SECRET` and the schedule workflow calls the tick |
| **N5** | `session/N5-gate-deploy` | Can you enter secrets in Render and GitHub, register the production webhook and approve sandbox pools now? | A failed S40 stops the session. Never ask the owner to paste a secret into chat. Add no card. S48 also checks the scheduled runs and that the app stays awake for several hours |
| **N6** | `session/N6-judge-polish-security` | Is the access code ready to enter outside the repo? | S50 uses the wording the S18 decision settled on. S51 findings go to the owner in chat, not into the repo, and every high-severity one is fixed before the session ends |
| **N7** | `session/N7-release-readiness` | Are you available to act as the sandbox buyer? | The README is tested by following only the README. The video pool must not show or imply a hold refresh |
| **N8** | None (no code) | Nothing | The owner records and submits. Draft the script, shot list and submission text (including the AI tools used), and check each requirement in `docs/hackathon-rules.md`. Put the access code only in a judges-only field. Submit nothing |
| **I1** | `session/I1-ledger-ai-eval` | The accuracy target for the AI test set (S39), at the end | S20 is a refactor: behavior and tests do not change. Stay inside the Groq daily caps |
| **I2** | `session/I2-pool-reliability` | Can you approve a sandbox pool for the refund run (S43)? | Tests use a controlled clock. A mismatch with PayPal pauses the pool and never repairs it |
| **I3** | `session/I3-hold-refresh` | An authorization ID or a fresh sandbox approval | Do not start before 2026-11-13T07:46Z, and S47b needs the S47a pool to be more than 3 days old. If either is false, stop and say when it will be true |
| **I4** | `session/I4-fault-tests` | Nothing | Every row of arch 8 gets a test and a visible plain-language message. Database tests run on the Docker Postgres |
| **I5** | `session/I5-extras` | Nothing | E1 uses demo data only. E2 uses only what AG Grid Community includes. E4's reset touches only that household's non-PayPal data |
| **I6** | `session/I6-extras-research` | Nothing | Research only, no code. Every claim has a source. End by saying whether each PRD open question can now be answered |

**Decisions the owner must make:**

1. **S08 (N1):** confirm authorize-and-capture as the path. Evidence: `docs/spike/S05.md`. Until then M1 cannot start.
2. **Architecture amendments:** none are planned. Drizzle, `groq-sdk` and the `stores` tables follow the arch, as you decided on 2026-11-11, and the other differences are fixed in code. If a step finds the arch can't be met, for example S10 shows strict schema doesn't work on the model, that step asks you. Any change to the arch needs your approval and an ADR.
3. **S18 (N1):** which user group leads and the four product changes. Needed before S50.
4. **Ownership:** who runs each session, so two people never edit `plan.md` at once.

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

**Context:** Arch Q4, Q5 and Q6. In v2 the app's refund and close flows already exist (S37, S43), so this spike now supplies the raw PayPal answers that M4 and S08 check the app against. **Your part:** approve a fresh authorization with the sandbox buyer.
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

**Context:** Arch Q7, Q5, 8. S38 builds on this, so run it before S38. PayPal needs a public HTTPS address. Use a free tunnel. `PAYPAL_WEBHOOK_ID` is empty in `.env` today. **Your part:** create the sandbox webhook pointing at the tunnel URL and put its ID in `.env`.
**Do:**
- Write `scripts/spike/webhook-receiver.ts`, which logs headers and bodies to `.spike-logs/`.
- Subscribe to the events in `project.md` and trigger them with S05 and S06a scripts.
- Record whether events identify each capture and carry `invoice_id`, and which failure event arrives.
- Verify one signature using the S04 call. Confirm a read call can total an authorization's captures.
- Write the summary to `docs/spike/S07.md`.

**Check:** the log contains capture, refund and void events.
**Done when:** Q7 is answered, one signature has been verified and captures can be totalled.

### S08: Gate: record the feasibility decision (Agent + You, Strongest)

**Context:** Arch 3 (payment rail seam), 9 and 10. In v2 the MVP was built on authorize-and-capture before this gate, and `docs/spike/S05.md` already answers the main question: Q1 yes (multiple partial captures, no PayPal approval step) and Q2 at least 30 captures. So this step records the decision instead of waiting on every spike. S06a, S07 and M4 then check the remaining questions against the built code. **Your part:** confirm the path. S08 may start while S06b is `blocked` on PayPal's honor period: use arch Q3's fallback for whatever S06b hasn't answered yet (`refreshHold` returns `unsupported` and the pool shows "hold needs refreshing"). S44 still waits for S06b.
**Do:**
- Read `docs/spike/` and choose: authorize-and-capture, the Payment Method Tokens fallback, or stop.
- Update arch 5, 7 and 10, ADR-0003 and ADR-0006, and any `plan.md` step the results change.
- If authorize-and-capture is chosen, set S08a to `skipped`.

**Check:** every one of Q1 to Q7 in arch 10 has a recorded result or a stated workaround.
**Done when:** the owner has confirmed a path. If neither path works, set this step to `blocked` and stop the plan here.

### S08a: Spike the token fallback (Agent + You, Strongest)

**Context:** Arch 3 (payment rail seam). Runs only if S08 chose the fallback. Expected to be `skipped`, because the MVP is built on authorize-and-capture. If it did run, S22, S24, S37 and S44 would need rework. **Your part:** request any PayPal approval it needs.
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

### S12: Test deploy on Render and Supabase (Agent + You)

**Context:** Arch Q10, ADR-0002. Northflank asked for a card, so S12 uses the fallback: a Render free web service, Supabase free Postgres and a GitHub Actions schedule. **Your part:** create the Render service and Supabase project, and enter the values in Render and GitHub, following `docs/spike/S12.md`.
**Do:**
- Deploy the `Dockerfile` on Render's free plan with `DATABASE_URL` and `DATABASE_CA_CERT` from Supabase, and point `.github/workflows/schedule.yml` at it with the `KITTY_BASE_URL` repo secret.
- Record the limits found, build time, memory use, cold start and whether anything sleeps in `docs/spike/S12.md`.

**Check:** the public URL returns `db: "ok"` and `dbTls: "verified"`, the scheduled calls appear in the Actions and Render logs, and no payment method was needed.
**Done when:** Q10 is answered for Render and Supabase.
**Undo:** delete the Render service and the Supabase project, and remove the `KITTY_BASE_URL` secret.
**Result (2026-11-11, `docs/spike/S12.md` on `main`):** the owner created the Render service and the Supabase project, and the deploy works with no card. Northflank is out (ADR-0002). Left open: scheduled (not manual) runs and a sleep check over several hours. S48 checks both, so this step is `done`.

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

## Phase M: Adopt the MVP

The MVP on `step/mvp-demo-flow` (two commits, based on `main` at 3657220) passes lint, typecheck and 413 tests. These steps bring it onto `main`, prove the claims its tests cannot, and remove the shortcuts that must not reach the submission.

### M1: Land the MVP and sync this plan (Agent + You)

**Context:** The MVP did not follow the one-step-per-branch process and did not update `plan.md`. This file replaces it, and the original is in `v1/plan.md`. **Your part:** confirm S08 and approve the pull request.
**Do:**
- Confirm S08 first (see the decision list under Status). Record it in `docs/adr.md` as a short note under ADR-0003: authorize-and-capture, per `docs/spike/S05.md`.
- Merge the latest `main` into the branch first. It has moved on since the MVP branched (pull requests 13 and 14 added the Render and Supabase results in `docs/spike/S12.md`), and `plan.md` there still shows S12 as `in-progress`. Keep this file's version of the status table.
- Open a pull request for the branch. Keep its history. Include `v1/plan.md` and this file.
- Check `src/domain/rules.test.ts` covers all eight combinations of rule outcome (needs approval or not) and AI decision (allow, flag, block, unavailable). Add any missing ones.

**Check:** the baseline checks pass in CI. `git ls-tree -r origin/main --name-only` lists `plan.md`, `v1/plan.md` and `src/domain/purchases.ts`.
**Done when:** the MVP and this plan are on `main`.

### M2: Move the tests to real Postgres and add race tests (Strongest)

**Context:** Arch 2 (Tests row) says Vitest on real Postgres, and rejects mocking the database. Arch 7.1 and 7.2 need real concurrent transactions. The MVP's tests run on in-memory PGlite, which uses one connection, so its race test probably never makes a second transaction wait on the pool row lock. The claim "a pool can never be overspent" is not yet proven.
**Do:**
- Replace `openTestDatabase` so every database test connects with `pg` to a dedicated test database on the Docker Postgres (`docker compose up -d db`), applies the schema, and resets between tests. The suite fails with a clear message when the database isn't running. It no longer uses PGlite.
- Add a Postgres service to the GitHub Actions workflow so CI runs the suite.
- Race one: $40 available and two $30 purchases submitted at once. Exactly one reaches `captured` and the other is `rejected_by_rules`.
- Race two: two approvals of the same waiting purchase at once charge once.
- Race three: a purchase and a close of the same pool at once. Either the purchase completes before the close or it is refused, and no money is reserved after `closing`.

**Check:** the tests pass against real Postgres, and each fails when the `FOR UPDATE` lock in `src/domain/purchases.ts` is removed (try it once by hand and note it in the pull request).
**Done when:** every row of the arch 7.1 table that involves concurrency has a passing test on real Postgres.

### M3: Remove simulated payments and PGlite from the app

**Context:** `createRail` falls back to a simulated rail that approves everything when PayPal keys are missing. `getDatabase` falls back to in-memory PGlite when `DATABASE_URL` is unset. The arch has neither: it has one Postgres database (arch 2, Database row) and a payment rail that talks only to PayPal (arch 3). S50 also forbids simulated results at submission.
**Do:**
- Move the simulated rail into the test helpers. In the app, missing PayPal keys show a plain "PayPal isn't set up" message, create nothing and move no state forward.
- Remove the PGlite fallback and the `@electric-sql/pglite` dependency. `DATABASE_URL` is required, and the app refuses to start without it, with a clear error naming `docker compose up -d db`.
- Search `src` for any other simulated or hard-coded result.

**Check:** with no PayPal keys, creating a pool fails with a plain message and leaves no `awaiting_payer` pool. With no `DATABASE_URL` the app fails at startup. `grep -ri pglite` finds nothing in `src`, `tests` or `package.json`.
**Done when:** no app path can approve a payment without PayPal or keep data outside the configured Postgres.

### M4: Walk the built flows against the PayPal sandbox (Agent + You, Strongest)

**Context:** The MVP was built and tested against fakes. This step shows each money flow works against the real sandbox. It supplies the "one real sandbox run" checks that S24, S32, S34, S36 and S37 need. **Your part:** approve each sandbox pool with the sandbox buyer.
**Do:** With the keys in `.env`, on the local app, run and record in `docs/test-results.md`:
- Create a pool and approve it at PayPal. Check `authorized_cents` came from PayPal's response.
- A member buys within their rules. A rule-breaking purchase is stopped before any AI call.
- A purchase over the approval amount waits, then is approved, and another is denied.
- One agent run within the Groq free limits (needs `GROQ_API_KEY`).
- Refund a captured purchase. Close the pool and check the remainder was voided.
- Open the owner ledger and check rows update in place and AI reasons show as plain text.

**Check:** PayPal's sandbox dashboard matches the ledger after each flow. Any mismatch is logged as a defect and fixed before S40.
**Done when:** every flow above has a recorded result, and S06a's answers (Q4 void and Q6 refund) agree with what the app did.

### M5: Reconcile the code and the architecture

**Context:** The MVP differs from `docs/architecture.md` in places listed under "What changed from v1". The owner decided to keep the architecture's original choices for Drizzle, `groq-sdk` and the `stores` tables, so those are fixed in code. The arch may still change where a step finds it can't be met.
**Do:** Read `src/`, `package.json`, the Dockerfile and the workflows against arch 2 (technology table), 3 (parts and seams), 5 (flows), 6 (data model and states), 7.4 (invariants) and 8 (failures). Then, for each difference:
- If it is on the known-deviation list, check the step that owns it exists, and leave the arch as it is.
- If it is on no list, ask the owner which way to go, and either add a step for it (following Changing this plan) or amend the arch with an ADR.

**Check:** a written list of every difference found, each marked "fixed by step X" or "arch amended (ADR number)".
**Done when:** every difference is one or the other. Run the check again at the end of N2 and I1: after I1 no difference remains.

---

## Phase C: Shared pools (MVP built)

Each step starts with **MVP status** (what the code already does) and lists what is left. A step whose status is `done` needs no further work unless M1, M2 or M4 finds a defect.

### S19: Drizzle schema, migrations and the missing tables

**MVP status:** `src/db/schema.ts` creates households, users, pools, pool_members, products, agent_runs, purchases, ledger_entries and usage_counters with the constraints from arch 7.1: `pools_never_overspent`, `pools_refund_within_captured`, `members_never_over_limit`, the unique `idempotency_key` and `paypal_order_id`, and the partial unique index for one open agent run. It runs as `CREATE TABLE IF NOT EXISTS` at startup.
**Left:**
- Adopt Drizzle ORM with `pg`, as arch 2 says. Put the schema in Drizzle, generate SQL-first migrations, and add a `db:migrate` script. Keep the domain code on the transaction port: `src/db` implements it with Drizzle, including `FOR UPDATE` row locks (S09 confirmed they work). The M2 test database and Actions service are reused. Running the migrations on a database made by the MVP must change nothing it already has.
- Add `authorizations` (previous authorization, PayPal ID, amount, `honor_ends_at`, `expires_at`, status), `refunded_cents` on `pool_members`, and on `purchases` the `needs_attention` flag, `approval_expires_at` and `decided_by`. The `webhook_events` table lands in S38. The `refreshing` and `paused` pool states land in S44 and S45.
- Replace the JSONB `allowed_stores` column with `stores` and `member_stores` tables, as arch 6 says, and migrate the existing data.

**Check:** tests on real Postgres prove each constraint rejects bad rows. Migrations run from empty and from an MVP-made database, and the existing tests pass unchanged. CI passes.
**Done when:** the database matches arch 6 apart from the tables later steps own, and the app uses Drizzle.
**Undo:** the local database can be dropped. The hosted database is created in S48, after this step.

### S20: Ledger module (Strongest)

**MVP status:** The balance formulas (`poolAvailable`, `memberRemaining`) are in `src/domain/rules.ts`. Reserve, capture-settled, release, refund-completed and close each lock the pool row with `FOR UPDATE` and append `ledger_entries`, but the SQL sits inside `purchases.ts` and `pools.ts`.
**Left:** Move that SQL into `src/domain/ledger`, behind the transaction port, so only the ledger changes funds. The purchase and pool services call it. Behavior and tests do not change.
**Check:** `npx vitest run src/domain` passes unchanged. No other module writes `reserved_cents`, `captured_cents`, `refunded_cents` or `released_cents` (search for them). Every row of the 7.1 and 7.3 tables has a passing test.
**Done when:** the "only the ledger changes funds" rule is true.

### S21: Hard rules

**MVP status:** done. `src/domain/rules.ts` implements pool usable, member active, store allowed, member limit and pool balance as pure functions. `finalOutcome` is strictest-wins: a $0 threshold means every purchase needs approval, and AI `allow` never loosens a rule. M1 checks the combination tests.

### S22: Payment rail seam (Strongest)

**MVP status:** `src/adapters/payments/rail.ts` implements `createPoolPayment`, `confirmPoolPayment`, `charge`, `refund` and `releaseHold` on the S04 client, with the fixed request IDs from arch 7.2 (`kitty-order-`, `kitty-auth-`, `kitty-capture-`, `kitty-refund-`, `kitty-void-`) and `finalCapture: false`. An unclear answer from `confirmPoolPayment` or `releaseHold` is resolved by reading PayPal, never guessed. Calls return `succeeded`, `failed`, `unsupported` or `unknown`.
**Left:**
- Add `verifyWebhookSignature` and `getCapture` (with S38).
- Add `getPoolPaymentState` (with S45) and `refreshHold` (with S44).
- Add the `holdsRealFunds` flag from arch 3, set to true for this adapter.
- After M3 the scriptable fake lives in the test helpers only.

**Check:** unit tests prove retries reuse the same request ID, for each new method too.
**Done when:** nothing outside the adapter knows PayPal details, and the interface matches arch 3.

### S23: Demo access and owner guard

**MVP status:** done. `src/server/session.ts` signs an httpOnly `SameSite=Lax` cookie, the access code is compared in constant time, the persona switcher changes user inside the household, and the user is re-read from the database on every call. `src/server/http.ts` rejects cross-site mutating requests. Owner-only actions check `pool.owner_user_id` in the domain code.

### S24: Create and approve pools (Agent + You)

**MVP status:** `createPool`, `confirmPool` and `abandonPool` in `src/domain/pools.ts` implement arch 5.1 with the 28-day cap. The create screen and the PayPal return and cancel routes exist. `authorized_cents` comes from PayPal's response, and `confirmPool` is safe to call twice.
**Left:**
- One recorded real sandbox approval (M4).
- Store `honor_ends_at` (3 days) and `expires_at` (29 days) on the `authorizations` row from S19. The MVP stores only `hold_expires_at`.
- A pool the owner never returns to is marked `abandoned` by the tick (S41a).

**Check:** M4's approval matches the sandbox dashboard.
**Done when:** a real approval opens a pool whose dates match arch 5.1.

### S25: Members and rules

**MVP status:** Members are chosen when the pool is created, with limit, approval amount and allowed stores validated in `validateNewPool`. There are no routes or screens to change them afterwards.
**Left:**
- Owner-only routes and screens to add and remove people and agents, and to change limit, allowed stores and approval threshold.
- Refuse a limit below what is already used. Cap a raised limit by the pool's available balance. Removing a member marks them inactive and never deletes the row.
- Take the pool lock for every change.

**Check:** route tests for owner-only access, removal, the limit floor and the raise cap.
**Done when:** each member's rules are editable and guarded.

### S26: Catalog seam and marketplace

**MVP status:** done. `src/adapters/catalog` has `search` and `featured` chosen by `CATALOG_PROVIDER`, a hand-written seeded catalog, and tests. The marketplace page renders product text as plain text. Every product has a local ID and local price.

### S27: Channel3 adapter

**MVP status:** The adapter is in `src/adapters/catalog/catalog.ts` with a fallback to the seeded catalog. Its quota handling and the purge were not reviewed when the MVP was assessed.
**Left:** Confirm, and add what is missing from, arch 3 and the v1 step:
- Searches are counted per month in `usage_counters`, and Kitty switches to the seeded catalog at 900 a month.
- Only products a search returned are stored, and a purge function removes unpurchased ones after 24 hours (S41b schedules it).
- No Channel3 response is committed. Tests use synthetic fixtures with S11's field shape.
- S11a's answer is recorded. If Channel3 rules the use out, ask the owner, who approves any PRD edit, then set `CATALOG_PROVIDER` to seeded and mark this step `skipped`.

**Check:** a test for the switch at 900 and one for the purge.
**Done when:** the free 1,000 cannot be exceeded.

### S28: Model seam and Groq adapter

**MVP status:** `src/ai/model.ts` calls Groq with `fetch`. It makes one call at a time, retries once on a rate limit within 20 seconds, checks the finish reason, and reports every problem as a typed failure that never means `allow`. `src/server/container.ts` stops AI calls at 800 a day, app-wide, counted in `usage_counters`.
**Left:** Replace the `fetch` wrapper with the `groq-sdk` package, as arch 2 says, behind the same `Model` interface so the reviewer and agent don't change. Keep one call at a time, the retry-delay handling and the typed failures. Add tests for pacing, for the cap surviving a restart and for each failure type. The per-household cap and the AI-off switch are done in S49.
**Check:** the tests above pass with the fake provider.
**Done when:** every failure returns a typed failure, never `allow`.

### S29: AI purchase reviewer

**MVP status:** done. `src/ai/reviewer.ts` makes one call with no tools, builds server-side facts with product text truncated, stripped of control characters and passed as labeled JSON, and returns `allow`, `flag` or `block` plus a reason. Any failure, truncated answer or invalid answer is `unavailable`, which sends the purchase to the owner.

### S29a: Strict review schema

**Context:** Arch 2 specifies strict JSON-schema output. The MVP uses Groq's `json_object` mode and checks the answer with Zod. Needs S10's result on whether strict schema works on this model.
**Do:** Switch the reviewer to strict JSON-schema output and keep the Zod check. If S10 shows the model can't do strict schema, ask the owner: either swap the model through the seam (E1, arch Q12) or keep `json_object` plus Zod and record the exception in an ADR.
**Check:** the reviewer tests pass for both a valid and an invalid answer.
**Done when:** the reviewer uses strict schema, or the exception is in an ADR.

### S30: Purchase service: checks and review (Strongest)

**MVP status:** done. `submitPurchase` takes the price from the `products` row, runs the hard rules in a locked transaction, and calls the reviewer with no transaction held. A repeated idempotency key returns the same purchase, and tests assert the reviewer is never called when a rule fails.

### S31: Purchase service: reserve and capture (Strongest)

**MVP status:** done. Tx B re-runs the rules and reserves, the capture runs outside any transaction, and Tx C settles with the purchase's own amount. An unclear outcome is `capture_unknown` with funds still reserved, and `recheckCapture` replays with the same request ID. Only a definite failure returns funds. The `refreshing` pause arrives with S44.

### S32: Member buying screens (Agent + You)

**MVP status:** The marketplace and purchase status screens exist (`Shop.tsx` and the purchases routes), with live status, plain-language reasons and the member's remaining limit.
**Left:** one real sandbox purchase and one stopped rule-breaking purchase in the browser (M4).
**Done when:** a teen can buy within their rules against the real sandbox.

### S33: Owner approval (Strongest)

**MVP status:** done. `approvePurchase` and `denyPurchase` check the owner, approval re-runs every hard rule under the pool lock, and approval cannot override a rule. Closing a pool expires waiting requests. Timed expiry of waiting requests comes with S41a.

### S34: AG Grid owner ledger

**MVP status:** `LedgerGrid.tsx` shows the purchases with Approve and Deny, and `BalanceBar.tsx` and `PoolDashboard.tsx` show the balances.
**Left:** confirm in the browser (M4) that the page polls every 2 to 3 seconds, rows update in place by purchase ID, and AI reasons show as plain text.
**Done when:** the owner can run approvals from the ledger.

### S35: Agent runner (Strongest)

**MVP status:** done. `src/ai/agent.ts` has exactly two tools with strict Zod arguments, takes member, pool and price from the run row, uses `runId:toolCallId` as the idempotency key, and caps turns (8) and purchase requests (6). One open run per agent is enforced by the partial unique index. The runner holds no payment credential.

### S36: Agent run screens (Agent + You)

**MVP status:** `AgentPanel.tsx` starts a run from the dashboard and shows its steps and the "at its free AI limit" message.
**Left:** one real run in the sandbox within free limits (M4). Its purchase appears in the owner's ledger.
**Done when:** an agent's purchase appears in the owner's ledger.

### S37: Close and release (Agent + You, Strongest)

**MVP status:** `closePool` in `src/domain/pools.ts` is owner-only, expires waiting approvals, refuses to close while a capture is in flight, voids the remainder through the rail, and finishes the close. If PayPal refuses the void, the pool still closes with a note that the hold will lapse. An unclear void leaves the pool `closing` and calling again retries.
**Left:** one real sandbox close (M4). Scheduled retries of a stuck `closing` pool come with S41b.
**Done when:** PayPal and the ledger agree after closing.

### S38: Webhook intake (Strongest)

**Context:** Arch 3 and 8. Use `docs/spike/S07.md`, so run S07 first. If S07 has not run, use PayPal's documented payloads and mark the results unconfirmed. **Your part:** create the sandbox webhook and put its ID in `PAYPAL_WEBHOOK_ID` in `.env`, which is empty today.
**Do:**
- Add the `webhook_events` table (unique `paypal_event_id`, type, payload, status, attempts, processed_at) as a migration.
- Add `verifyWebhookSignature` and `getCapture` to the rail (S22).
- `POST /api/paypal/webhook`: check the signature on the raw body, dedupe, apply forward-only changes for capture completed, declined, denied, refunded and authorization voided, store unmatched events, and mark a purchase `needs_attention` when an event contradicts the ledger.

**Check:** fixtures for duplicate, reordered, unmatched and contradictory events, and an unsigned event being rejected.
**Done when:** repeating any event changes nothing.

### S39: Labeled AI test set (Agent + You)

**Context:** PRD metric "AI purchase review quality", arch Q12. Runs must fit the free limits. Needs S10's token figures. **Your part:** agree the target.
**Do:**
- Create on-goal, off-goal and manipulation cases, including hidden text in product descriptions.
- Add a paced runner and record accuracy in `docs/ai-eval.md`.
- Propose a target. If Groq falls short, tell the owner E1 can be done sooner by changing its dependency.

**Check:** the run finishes without exceeding the daily caps.
**Done when:** there is a measured result and an owner-agreed target.

### S40: Gate: milestone 3 scenarios (Agent + You, Strongest)

**Context:** Arch 9 milestone 3, PRD success metrics. In v2 this gate runs without the full labeled set so it fits before the deadline. **Your part:** approve the sandbox pools the scenarios use.
**Do:** Script scenarios against the sandbox and real Postgres, and record results in `docs/test-results.md`:
- Every rule-breaking purchase is stopped, and the reviewer was never called for it.
- Off-goal purchases: try at least five by hand against the live Groq reviewer within the free limits. Each is flagged or blocked, and the result is recorded as a spot check, not a measured rate.
- The M2 race tests pass, with 0 pools overspent.
- The replay test shows one charge for a repeated request.
- The pool-integrity comparison (captured total against PayPal's) is recorded.

**Check:** all of the above pass. A failure stops session N5, sets this to `blocked`, and inserts a fix step before S48.
**Done when:** all pass. S39 runs after the submission and its measured result is added to `docs/test-results.md` then.
---

## Phase D: Full-term pools

### S41a: Tick endpoint and purchase recovery (Strongest)

**Context:** Arch 2 (scheduled work), 8. Authenticated by `CRON_SECRET`. The MVP has no tick and `.github/workflows/schedule.yml` still calls `/api/health`. The MVP already replays an unclear capture by hand through `recheckCapture`, and the tick automates that.
**Do:** `/api/internal/tick` with jobs for stale `reviewing`, stale `capturing`, `capture_unknown` replay (reusing `recheckCapture`'s request ID), expired approvals, pools the owner never returned to (`abandoned`) and stale agent runs. Hold no lock across a network call. Point the schedule workflow at the tick route.
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

**Context:** Arch 5.4, 7.3. Whole-purchase refunds, owner only, including on closed pools. **MVP status:** `refundPurchase` is built and tested: owner only, `refund_pending` to `refunded`, "refunded, limit stays used", and a refused refund returns the purchase to `captured`. M4 runs one real refund. **Your part:** approve a sandbox pool.
**Do:** What is left is a tick job replaying unknown refund outcomes, the member `refunded_cents` column from S19, and applying `docs/spike/S06a.md`.
**Check:** the 7.3 table, the owner guard and a closed-pool refund pass, plus one sandbox refund.
**Done when:** refunded money is not offered as spendable, unless S08 proved otherwise.

### S44: Hold refresh (Agent + You, Strongest)

**Context:** Arch 5.5, Q3. Depends on `docs/spike/S06b.md`, which is blocked until 2026-11-13T07:46Z, and on the `authorizations` table from S19. The MVP stores one `authorization_id` on the pool and has no `refreshing` state. Add `refreshHold` to the rail (S22). **Your part:** approve a sandbox pool.
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

**Context:** Arch 2, ADR-0002, `docs/spike/S12.md`. Reuse the S12 Render service and Supabase project, since free Render allows only one always-awake service. **Your part:** enter secrets in Render and GitHub, and register the production webhook in PayPal.
**Do:** Deploy the app, set `APP_URL` so PayPal's return links are correct, and schedule the tick (S41a). Until S19 adds migrations the app creates its schema at startup, so no agent needs to handle the production `DATABASE_URL`. After S19, run migrations as a host job instead. M3 makes the app refuse to start in production without `DATABASE_URL`. Add no card. If S12 chose the fallback, use arch Q10.
**Check:** the hosted app passes a sandbox purchase and receives its webhook. The scheduled calls appear in the GitHub Actions log, and the app stays awake across several hours (the part of S12 left open).
**Done when:** the URL is stable and the tick is running.

### S47a: Gate, part 1: start a full-term pool (Agent + You)

**Context:** Arch 9 milestone 4. Runs on the hosted app. **Your part:** approve the pool.
**Do:** Create a pool, spend from it, and note its start date in `docs/test-results.md`.
**Check:** the first purchases appear in the ledger and PayPal.
**Done when:** the pool is active. S47b can run once 3 days have passed, and nothing before the submission waits for it.

### S47b: Gate, part 2: finish the full-term pool (Agent + You)

**Context:** Arch 9 milestone 4. Run this after the honor period has passed, which falls after the hackathon submission. **Your part:** confirm the results in the sandbox dashboard.
**Do:** Spend again, refresh the hold, refund a purchase, close the pool and record the results and pool-integrity comparison in `docs/test-results.md`.
**Check:** the pool is usable after the honor period and the ledger matches PayPal.
**Done when:** the gate passes. A failure sets this to `blocked`, and a fix step is inserted.

---

## Phase E: Public demo

### S49: Judge access (Agent + You)

**Context:** Arch Security, Judge access. **Your part:** fill in the access code and sandbox login outside the repo.
**Do:** Add the per-household cap on agent runs and reviews, and the AI-off switch, to the model seam (S28 has only an app-wide 800 a day). Set the caps for shared use, confirm the access code appears nowhere in the repo, and write `docs/judge-notes.template.md` with placeholders only. Add a query for the PRD's delegation follow-through metric: the share of demo households that created a pool and added a member.
**Check:** a fresh visitor can reach a working household with only the access code.
**Done when:** a judge needs no real account.

### S50: Polish the core screens

**Context:** PRD MVP. Design is an equal judging area. Use the wording the S18 decision settled on, so S18 must be decided first.
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

**Context:** The video uses this pool. A real hold refresh needs a pool more than 3 days old, so the video must not show or imply one.
**Do:** Create and approve the pool for the video.
**Done when:** the pool is active.

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
| 2026-11-10 | Set the deadline to Nov 12, 2026, 12:00 pm Pacific | S15a read it in the Official Rules, and the owner decided to enter and follow this plan |
| 2026-11-10 | Removed the 3-day waits from the path to S55: S50 now depends on S47a, S53a no longer waits, and S47b runs after the submission | A 3-day wait ends after the deadline. The owner approved, and the rules don't require a hold refresh |
| 2026-11-10 | S27 counts Channel3 searches per month | S11 found the 1,000 free credits renew monthly |
| 2026-11-10 | S06b `blocked` until 2026-11-13T07:46Z, and S08 may proceed on arch Q3's fallback while it waits | The sandbox refuses reauthorization before day 4 (`REAUTHORIZATION_TOO_SOON`), which falls after the deadline. The owner approved this in the S06b plan |
| 2026-11-11 | S12 and S48 move from Northflank to Render free, Supabase free and a GitHub Actions schedule (ADR-0002) | Northflank asked for a card before deploying, and the owner declined |
| 2026-11-11 | Original plan moved to `v1/plan.md`. This file is version 2, which starts from the MVP on `step/mvp-demo-flow` | A teammate built most of Phase C ahead of the plan. The plan now builds on that work |
| 2026-11-11 | Added Phase M (M1 to M5) | Land the MVP, prove race safety on real Postgres, remove simulated payments, check the flows against the sandbox, and record where the MVP differs from the arch |
| 2026-11-11 | Added the "When" column (`D` before the deadline, `P` after) and the path to submission | Keeps the Nov 12 deadline reachable |
| 2026-11-11 | Phase C steps now carry an **MVP status** and list only what is left. S21, S23, S26, S29, S30, S31, S33 and S35 are `done`. S19, S20, S22, S24, S25, S27, S28, S32, S34, S36, S37 and S43 are `in-progress` | Matches the code on `step/mvp-demo-flow` |
| 2026-11-11 | S08 becomes "record the feasibility decision" and depends only on S05. S22 no longer waits for S18 | S05 answered Q1 and Q2, and the MVP is built on authorize-and-capture. S18 only affects wording, so it is now needed before S50 |
| 2026-11-11 | S40 runs on the scenarios that need no labeled test set, and S39 moves after the submission | S39 needs S10 and the Groq free limits, and S40 gates S41a |
| 2026-11-11 | S48 now depends on S12 and S41a instead of S46c. S41b, S42, S44, S45 and S46a to S46c move after the submission | Fits the deadline. The arch already says the video does not show a hold refresh |
| 2026-11-11 | S24 no longer depends on S22, S32 no longer depends on S25, and S36 no longer depends on S25 | Those steps only need the flows M4 verifies. Editing members (S25) and the webhook methods (S22) are not needed to open a pool, buy or run an agent |
| 2026-11-11 | The arch may change when that is the better choice, and M5 reconciles the code with it. For Drizzle, `groq-sdk` and the `stores` and `member_stores` tables the owner decided to keep the arch's original choices, so S19 adopts Drizzle and the tables, S28 adopts `groq-sdk`, and S29a allows an ADR exception only if the model can't do strict schema. M2 moves the whole test suite to real Postgres and M3 removes PGlite and the simulated rail. S12 stays `done` | The owner allowed flexibility with the architecture, and decided to keep these three choices as the arch has them. |
| 2026-11-11 | Drizzle (S19), `groq-sdk` (S28) and strict review schema (S29a) move before the deadline, together with S10. New session N2 (Align with the architecture) runs after N1 and before the live sandbox check, which is now N3. Later necessary sessions shift to N4 to N8, and the improvement sessions become I1 to I6. S25 and S38 now depend on S19 | The owner wants the architecture's choices kept before the deadline. Running them before the live check means the sandbox is tested on the final code, and the stores tables and migrations exist before S25 and S38 use them |
| 2026-11-11 | Added "Starting a session" to `rules.md` and the Session briefs table, so a session can start from one line such as "read the md files and start the session". `rules.md` now speaks of sessions, not steps | The owner wants to start each session without writing a prompt |
| 2026-11-11 | S12 is `done`: the Render service and Supabase project are connected (`docs/spike/S12.md` on `main`). It leaves the deploy session, and S48 checks the scheduled runs and the sleep behavior | The owner created and connected both services in session S12 |
| 2026-11-11 | Steps bundled into 14 sessions (N1 to N7 necessary, I1 to I7 improvements; renumbered by the last row of this group). The run rules now work per session, with one branch `session/<id>-<name>` and one pull request each. Added the Session column | The owner asked for fewer, larger sessions, with the necessary work first |
| 2026-11-11 | S41a now depends on M2 and S38 instead of S40, S40 now depends on S41a, and S45 also depends on S19 | The tick is built before the gate session, and the paused state needs the S19 tables |
| 2026-11-11 | Added S29a (strict review schema) | The MVP uses `json_object` plus Zod, and the arch specifies strict schema. It waits on S10 |
| 2026-11-11 | S19 now means migrations and the missing tables, S20 means extracting the ledger module, and S49 adds the per-household AI cap and AI-off switch | The MVP runs startup SQL, keeps ledger SQL inline, and has only an app-wide AI cap |
