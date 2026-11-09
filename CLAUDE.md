# Kitty

Shared PayPal spending pools for families and AI agents. An owner approves one PayPal authorization, and members and agents spend from it in pieces under their own rules, with AI checking each purchase. Built for the PayPal AI Hackathon. Sandbox only.

## Start here

- **Work comes from `plan.md`.** Do one step per chat: the first `pending` step whose dependencies are `done`, unless the owner names another. Follow "How to run a step" in that file, and keep its status table current.
- **Requirements:** `.claude/prds/kitty.prd.md`
- **Design:** `docs/architecture.md`
- **Decisions:** `docs/adr.md`
- **Research:** `docs/research.md`
- `project.md` is the original plan and is out of date. It still says "Circle", Claude and Render. Use it only for the PayPal API map and webhook list.

## Stack

Next.js App Router and TypeScript on Northflank's free plan, Postgres with Drizzle, Zod, Vitest, PayPal sandbox REST through a small `fetch` wrapper, Groq free plan (`openai/gpt-oss-120b` through `groq-sdk`), Channel3 for products and AG Grid Community for the ledger.

```bash
npm run lint && npm run typecheck && npm test
```

```bash
docker compose up -d db
```

## Hard rules

**Money**
- Only the ledger changes funds, inside a short transaction that locks the pool row. Never hold a transaction across an AI or PayPal call.
- An unknown capture outcome keeps funds reserved. A retry reuses the same `PayPal-Request-Id`.
- A refund does not make money spendable unless the spike results prove it can.

**AI and agents**
- Hard rules run in code before any AI call. AI can only flag or block, and any AI failure sends the purchase to owner approval.
- Agents have only `search_products` and `request_purchase`. Member, pool and price always come from the server, never from model output.
- Product text is untrusted input. Never put it in a system prompt, and render it as plain text.

**Budget: $0**
- Use free plans only. Never add a card or upgrade a plan, and never propose a paid service as the answer.
- Count AI and Channel3 usage, and stop before the free limits.

**Safety**
- Sandbox only. The payment adapter has no setting for live payments.
- This repo is public. No secrets, real personal data or bulk Channel3 data. `.env` is local and never committed.
- The owner enters their own credentials. Agents don't handle them, and never open or print `.env`.
- Raw spike logs stay in the gitignored `.spike-logs/` folder.

## Working rules

- Ask before changing the PRD. Record milestone progress in `plan.md`.
- If a step changes a design decision, update `docs/architecture.md` and `docs/adr.md` in the same branch.
- Unverified claims stay marked **[verify]** until checked. Record sanitized spike results in `docs/spike/<step-id>.md`.
- Keep to the step in hand. Nice-to-have extras (Phase F) come last.
- Branch from `main` as `step/<id>-<short-name>`. Finish the step on its branch, then stop and ask the owner to approve the commit, push, pull request and merge. A dependency counts only once it is merged to `main`.
- Commit messages must not include `Co-Authored-By: Claude` or any other Claude attribution.
