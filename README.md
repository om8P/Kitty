# Kitty

**Approve once on PayPal. Then your family and your AI shopping agent spend from one shared pool, each with their own limits, and AI checks every purchase before a cent moves.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Sandbox only: no real money ever moves.

## How it works

1. **Approve once.** A parent creates a pool (for example "Back-to-school supplies for Sam, $150, two weeks") and approves it once on PayPal. That creates a PayPal **authorization**: the money is held, not charged.
2. **Rules for every spender.** Each family member and each AI agent gets a spending limit, allowed stores, and an "ask me first above" amount.
3. **Real products.** The marketplace and the agent's search use **Channel3**.
4. **Two checks on every purchase.** Hard rules run in code first; then AI (Groq, `openai/gpt-oss-120b`) checks the item fits the pool's goal. AI can flag or block, never approve extra spending.
5. **Pay in pieces.** Each allowed purchase is a **partial capture** on the PayPal authorization.
6. **An AI agent with no access to money.** It can only search and ask to buy, under the same rules.
7. **One ledger.** Every attempt shows up in an **AG Grid** ledger, where the parent approves, denies or refunds.
8. **Close.** Closing **voids** the rest of the authorization. Only what was spent is charged.

## Sponsor tools

| Tool | Role in Kitty |
|---|---|
| **PayPal** (Orders v2, Payments v2, Webhooks) | Authorize once, partial captures, refunds, void at close, signature-verified webhooks |
| **Channel3** | Live product search for the marketplace and the AI agent |
| **AG Grid** (Community) | The parent's live ledger with in-cell actions, filter and CSV export |
| **Render** | Hosting from the `Dockerfile`, with Supabase Postgres |

## Run it locally

You need **Node.js 22.13 or newer**, **Docker** (for Postgres), and free accounts for the PayPal Developer sandbox and Groq. Channel3 is optional.

```bash
git clone https://github.com/om8P/Kitty.git
cd Kitty
npm install
docker compose up -d db
cp .env.example .env      # then fill it in, see below
npm run dev               # http://localhost:3000
```

The app applies its database migrations on startup.

### `.env`

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://kitty:kitty@localhost:5432/kitty` for the Docker database |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Yes | From a **sandbox** REST app at developer.paypal.com. Use an app linked to a **US** sandbox Business account |
| `GROQ_API_KEY` | Yes | From console.groq.com (free plan) |
| `CHANNEL3_API_KEY` | No | From trychannel3.com/developers. Without it the shop uses a built-in sample catalog |
| `CATALOG_PROVIDER` | No | `channel3` to use Channel3 when a key is set, `seeded` to force the sample catalog |
| `SESSION_SECRET` | Recommended | Any long random string |
| `DEMO_ACCESS_CODE` | No | If set, visitors must enter this code to start the demo |
| `CRON_SECRET` | No | Protects the `/api/internal/tick` background job |
| `AI_ENABLED` | No | `off` switches AI off: every purchase then goes to the owner for approval, and the agent won't start. On when empty |
| `PAYPAL_WEBHOOK_ID` | No | Only needed to receive PayPal webhooks (needs a public HTTPS URL) |
| `APP_URL` | When hosted | The public base URL, used for PayPal's return links |
| `DATABASE_CA_CERT` | When hosted | The hosted database's CA certificate (PEM), for verified TLS |

## Try the demo flow

1. Open the app and click **Start the demo**. You get a fresh household: **Alex** (owner) and **Sam** (teen), plus a shopping agent.
2. **Create a pool** and click **Continue to PayPal**.
3. On PayPal, log in with a **US sandbox Personal** account (developer.paypal.com → Testing Tools → Sandbox Accounts) and approve. A Business account can't pay itself.
4. Switch to **Sam** in the header and shop: an allowed item is paid, headphones are blocked by the store rule, and the "Collector's mystery figure" (its listing hides a prompt injection) is blocked by the AI.
5. Switch back to **Alex**: approve the waiting purchase, send the agent shopping, check the ledger, refund, then **Close pool**.

### AI limits

Kitty stays inside Groq's free plan: at most 800 AI requests and 150,000 tokens a day across the app, and 40 purchase reviews and 5 agent runs a day per household. Past a limit, nothing is blocked by it alone: purchases go to the owner for approval.

### Hosting

The hosted demo runs on Render's free plan with Supabase's free Postgres ([`docs/spike/S12.md`](docs/spike/S12.md)). Render sleeps after 15 idle minutes, so a free outside scheduler (for example cron-job.org) posts to `/api/internal/tick` every 5 minutes with `Authorization: Bearer <CRON_SECRET>`, which keeps it awake and runs the background jobs on time.

## Development

```bash
npm run lint && npm run typecheck && npm test
```

Database tests use the Docker Postgres (`docker compose up -d db`).

Design and decisions: [`docs/architecture.md`](docs/architecture.md), [`docs/adr.md`](docs/adr.md). Sandbox test results: [`docs/test-results.md`](docs/test-results.md).

## License

MIT, see [LICENSE](LICENSE).
