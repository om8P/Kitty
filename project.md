# Circle

Shared spending pools for families and AI agents, built on PayPal.

A user approves a budget once. Family members and AI shopping agents then spend from it in pieces, each within their own rules, and AI checks every purchase against the budget's stated goal.

**Inspiration:** India's UPI Circle (delegated payments) and UPI Reserve Pay (block funds once, debit in pieces). Verify any claims about UPI before using them in the pitch.

**Status:** planning. Nothing is built yet, and the first task is the sandbox spike below.

## Hackathon fit

| Requirement | How Circle meets it |
|---|---|
| Integrates the PayPal developer platform (sandbox) | Every pool and purchase runs on PayPal authorizations and captures |
| Uses an AI tool or model | Claude powers the shopping agent and reviews each purchase |
| PayPal is central | Without the authorization and its partial captures, there is no pool |
| New or significantly updated | New project |
| Runs as shown in the video | Demo uses only flows confirmed against the real sandbox |

**Still needed from the rules:** deadline, judging criteria, submission format, prize categories and section 8 (sponsor prize requirements).

## How it works

1. **Reserve.** The owner creates a pool, such as "$150 for groceries, next 4 weeks", and approves it once in PayPal.
2. **Delegate.** The owner adds members and agents, each with their own rules.
3. **Spend.** A member or agent requests a purchase from the demo marketplace.
4. **Check.** Circle applies the hard rules in code, then AI reviews the purchase against the goal.
5. **Capture.** An allowed purchase becomes a partial capture on the authorization.
6. **Close.** The owner closes the pool, or it closes before day 29, and the unused balance is released.

## Member rules

| Rule | Meaning |
|---|---|
| Spending limit | Most this member can spend from the pool |
| Allowed stores | Marketplace stores this member can buy from |
| Approval threshold | Purchases above this amount need the owner's approval |
| Delegation mode | **Partial:** owner approves every purchase. **Full:** member spends freely within limits |

## Design constraints

| Constraint | Design decision |
|---|---|
| The payee is set at order creation, and the capture request has no payee field | Circle is the merchant. "Stores" exist inside a demo marketplace. Do not claim spending at arbitrary merchants |
| Authorizations last 29 days | Sell a "4-week pool", never "this month". Close pools before day 29 |
| Funds are best captured within the 3-day honor period | Reauthorize when needed, show a "hold needs refreshing" state, and handle failed captures |
| Reauthorizing returns a new authorization ID | Store the current ID on the pool and keep the history |
| Total captures can default to as much as 115% of the authorization | Circle's ledger enforces the pool amount and never overcaptures |
| AI can be wrong or manipulated | Hard limits run in code first. AI can only flag or block, never approve extra spending or raise a limit |
| Product text is untrusted input | Treat store and product text as data in AI prompts, never as instructions |

## PayPal API map

| Feature | PayPal API |
|---|---|
| Create the pool | `POST /v2/checkout/orders` with `intent: AUTHORIZE` |
| Reserve the budget after buyer approval | `POST /v2/checkout/orders/{id}/authorize` |
| Each purchase | `POST /v2/payments/authorizations/{id}/capture` with a partial `amount` and `final_capture: false` |
| Last purchase | The same call with `final_capture: true` |
| Release the unused balance | `POST /v2/payments/authorizations/{id}/void` |
| Refresh the hold | `POST /v2/payments/authorizations/{id}/reauthorize` |
| Refund a purchase | `POST /v2/payments/captures/{id}/refund` |

**Webhooks**

- `PAYMENT.AUTHORIZATION.CREATED`
- `PAYMENT.AUTHORIZATION.VOIDED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.DECLINED` and `PAYMENT.CAPTURE.DENIED` (the docs list both, so handle both)

Use a unique `PayPal-Request-Id` on each capture so a retry cannot charge twice. Verify webhook signatures before trusting them.

## Purchase check order

Every purchase passes through one server-side function, in this order:

1. Pool is active and its authorization is usable.
2. Requester is a member of the pool.
3. Store is allowed for this member.
4. Amount fits the member's remaining limit and the pool's remaining balance.
5. AI reviews the purchase against the pool's goal: `allow`, `flag` or `block`, with a reason.
6. Approval is requested if the delegation mode, the threshold or an AI flag requires it.
7. Funds are reserved in the ledger, then captured at PayPal. A failed capture releases the reservation.

AI agents get a `request_purchase` tool that calls this function. They never get a direct capture tool, and they cannot edit rules.

## Architecture

- **App:** Next.js and TypeScript, for the web UI and server routes
- **Database:** Postgres
- **AI:** Claude API with tool use, for the shopping agent and purchase review
- **Payments:** PayPal sandbox REST APIs and webhooks
- **Hosting:** to be decided. Render is a sponsor option if a sponsor prize is worth pursuing

### Data model

| Table | Key fields |
|---|---|
| `pools` | owner, goal, amount, currency, PayPal order ID, current authorization ID, status, expires at |
| `members` | pool, name, type (person or agent), limit, delegation mode, approval threshold |
| `member_stores` | member, allowed store |
| `stores`, `products` | demo marketplace catalog |
| `purchases` | pool, member, product, amount, status, AI decision, AI reason, PayPal capture ID |
| `approvals` | purchase, status, decided at |
| `authorizations` | pool, PayPal authorization ID, created at, honor period ends at |
| `webhook_events` | PayPal event ID (unique), type, payload, processed at |

## Build plan

### 1. Sandbox spike (do this first)

One script against the real sandbox: authorize $150, make three partial captures, reauthorize, then void the remainder. It must answer:

- [ ] Are multiple partial captures enabled on the sandbox account? PayPal's help pages say the feature must be enabled or approved.
- [ ] How many captures can one authorization take? No maximum was found in the docs.
- [ ] Can an authorization be reauthorized after a partial capture, and what balance carries over?
- [ ] Can the remainder be voided after a partial capture in the v2 API?
- [ ] Which event is sent for a failed capture: `DECLINED` or `DENIED`?

**If partial captures are blocked:** save the buyer's PayPal with the Payment Method Tokens API and charge each purchase separately. This loses real reserved funds, and PayPal requires account approval for it, so it is a last resort.

### 2. Core

- [ ] Project setup, database and environment config
- [ ] Create a pool and complete PayPal approval
- [ ] Members and rules
- [ ] Demo marketplace
- [ ] Purchase check, ledger and capture
- [ ] Close pool and refunds
- [ ] Webhooks

### 3. AI

- [ ] Purchase review with structured output
- [ ] Shopping agent using `request_purchase`
- [ ] Test set of on-goal, off-goal and prompt-injection purchases

### 4. Product

- [ ] Owner dashboard: pool balance, members, activity and approvals
- [ ] Member and agent spending view
- [ ] Clear states for failed captures and expiring holds

### 5. Submission

- [ ] Deploy and test the whole flow from a clean account
- [ ] README with setup steps and sandbox test accounts
- [ ] Demo video
- [ ] Project description, including AI tools and third-party services used

## Demo script

1. Owner reserves $150 for groceries and approves once in PayPal.
2. Owner adds a family member on partial delegation and an AI agent on full delegation with a $40 limit.
3. The agent buys groceries, and the capture appears in the PayPal sandbox.
4. The agent tries to buy headphones, and AI blocks it with a reason.
5. The family member's purchase waits for the owner, who approves it.
6. A purchase over the agent's limit is stopped by the hard rules, before AI runs.
7. Owner closes the pool, and the unused balance is released.

**Pitch line (once verified):** "India proved this at national scale. We're bringing it to PayPal's global users."

## Out of scope for the hackathon

- Spending at merchants outside the marketplace
- Paying out to separate sellers (needs a PayPal platform setup)
- Live payments. Everything runs in the sandbox
- A native mobile app

## Setup

Create `.env` locally and never commit it:

```
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
ANTHROPIC_API_KEY=
DATABASE_URL=
```

## References

- [Authorization and capture](https://developer.paypal.com/docs/checkout/standard/customize/authorization/)
- [Capture API](https://developer.paypal.com/api/payments/v2/authorizations-capture)
- [Create order API](https://developer.paypal.com/api/orders/v2/orders-create)
- [Webhook events](https://developer.paypal.com/api/rest/webhooks/event-names/)
- [Save PayPal with Payment Method Tokens](https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/)
- [Partial capture help](https://www.paypal.com/webapps/mpp/get-started/payment-authorization)
- [PayPal MCP quickstart](https://docs.paypal.ai/developer/tools/ai/mcp-quickstart.md)
