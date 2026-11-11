# Kitty

Shared PayPal spending pools for families and AI agents. An owner approves one PayPal authorization, and members and agents spend from it in pieces under their own rules, with AI checking each purchase. Built for the PayPal AI Hackathon. Sandbox only.

## Start here

- **Work comes from `plan.md`, in sessions.** Do one session per chat. Follow "Starting a session" below and "How to run a session" in that file, and keep its status table current.
- **Requirements:** `.claude/prds/kitty.prd.md`
- **Design:** `docs/architecture.md`
- **Decisions:** `docs/adr.md`
- **Research:** `docs/research.md`
- `project.md` is the original plan and is out of date. It still says "Circle", Claude and Render. Use it only for the PayPal API map and webhook list.

## Starting a session

When the owner says something like "read the md files and start the session", do this without asking what to do:

1. **Read.** `rules.md`, then `plan.md`: "How to run a session", the Status table, the Sessions tables, the Session briefs, and the sections of the steps in the session. Read the arch sections those steps name, and `docs/adr.md` where they touch a decision.
2. **Check the repo.** Run `git fetch` and `git status`. Leave uncommitted work and other branches alone. If the working folder is dirty or on another branch, make a git worktree for the session (`git worktree add ../PayPal-<session id> -b <branch> origin/main`, or check out `origin/step/mvp-demo-flow` for N1) and work there.
3. **Pick the session.** Unless the owner names one, take the first session in order N1 to N8, then I1 to I6, that still has a step not `done` or `skipped` and whose "Starts when" and dependencies are met. Trust `origin/main`, not just the status table, for what is merged. If a branch `session/<id>-*` already has commits, resume that session. If the next session can't start (for example I3 before its date), say why and offer the next one that can.
4. **Say what you picked** in two lines: the session, its steps and its branch.
5. **Ask the owner's questions** from the session's "Ask first" brief, together in one message. Don't ask anything the plan already answers.
6. **Run the session** as "How to run a session" says, in the listed step order, using the model the Sessions table names.
7. **Finish.** Update `plan.md` statuses, report what is done, blocked or left, then stop and ask the owner to approve the commit, push, pull request and merge.

## Stack

Next.js App Router and TypeScript on Render's free web service, Postgres on Supabase's free plan with Drizzle, a GitHub Actions schedule, Zod, Vitest, PayPal sandbox REST through a small `fetch` wrapper, Groq free plan (`openai/gpt-oss-120b` through `groq-sdk`), Channel3 for products and AG Grid Community for the ledger.

```bash
npm run lint && npm run typecheck && npm test
```

```bash
docker compose up -d db
```

## UI

Design every screen to feel like PayPal's current product: calm, trustworthy, white and black first, with blue used sparingly. Values below were read from paypal.com on 2026-11-10. Use them as CSS variables, never as one-off values.

**Direction**
- People should see the money first: what's available, what's been spent and what needs a decision.
- Owner screens are a repeat-use tool, so keep them quiet and scannable. Member screens are simpler, with one main action.
- Kitty's signature element is one balance bar showing available, reserved and captured funds. Use it wherever a pool's balance appears.

**Color**

| Token | Value | Use |
|---|---|---|
| `--text` | `#000000` | Headings and body |
| `--text-muted` | `#686A6D` | Secondary text |
| `--surface` | `#FFFFFF` | Page and cards |
| `--surface-warm` | `#F1EFEA` | Occasional section background |
| `--navy` | `#002991` | Dark bands and the signature element |
| `--blue` | `#0066F5` | Links and focus rings only |
| `--sky` | `#60CDFF` | Highlights on navy |
| `--tint` | `rgba(5, 55, 130, 0.08)` | Secondary buttons and selected rows |
| `--line` | `rgba(0, 0, 0, 0.1)` | Dividers and card borders |

Status colors are Kitty's own: green for captured, amber for needs approval or a hold needing refresh, red for blocked or failed. Always pair a status color with a text label, and check contrast.

**Type**
- PayPal's typefaces are proprietary, so don't use them. Use Plus Jakarta Sans at weight 800 for headings and Inter for everything else, both loaded with `next/font/local` from `assets/fonts/`. Keep each font's license file beside it.
- Headings are black and bold. Body is 16px at weight 400. Screen titles are 28 to 32px, because these are app screens rather than marketing pages. Reserve 40px and up for the landing page.
- Money uses tabular numbers, always shows the currency, and is the largest text in its group.

**Components**
- Primary button: black pill with white text, 48px tall, `12px 20px` padding, radius `1000px`, weight 700. Use one per view.
- Secondary button: the same shape on `--tint` with black text.
- Cards: white, radius `24px`, with a `--line` border or generous spacing. Small elements use `8px` or `12px`.
- Never put a card inside a card. Theme AG Grid with these tokens and keep it flat, with row dividers only.
- Use 8px spacing steps and generous space between sections. Keep ledger rows compact.

**Every screen handles each state that applies, and each has a safe next action:** loading (stable layout), empty (say what's missing and what to do), error (the specific failure and a recovery path), partial (show what's available and mark the rest), success (confirm and show what's next), and permission (say who can do this).

**Avoid:** gradients, purple, decorative blobs, stock-style images, oversized marketing heroes inside the app, text that explains what the controls already show, and blue as a general-purpose button color.

**Before a UI step is done:** check the rendered screen in a browser at `390x844` and `1440x900`. Check keyboard use, visible focus, labels, contrast, touch targets, long text and each applicable state. Run `/ecc:frontend-design-direction` for its evidence check on major screens.

**Kitty stays visibly its own product.** PayPal's look guides the style, but a user must never mistake Kitty for PayPal.
- Use Kitty's own name and logo, and never PayPal's logo, wordmark, images or marketing copy as Kitty's branding.
- Never build a Kitty screen that resembles a PayPal login or payment approval page. Approval happens on PayPal's real site.
- PayPal's marks appear only in its official buttons or a factual "Pay with PayPal", as its brand guidelines allow.
- Show a visible "Sandbox" label on every screen that involves payment.

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
- Keep to the session in hand. Improvement sessions (I1 to I6) come after the necessary ones (N1 to N8).
- Use the session's branch from `plan.md` (`session/<id>-<short-name>` cut from `main`; N1 uses `step/mvp-demo-flow`). Finish the session on its branch, then stop and ask the owner to approve the commit, push, pull request and merge. A dependency counts only once it is merged to `main`. Commit once per step, with the step ID in the message.
- Commit messages must not include `Co-Authored-By: Claude` or any other Claude attribution.
