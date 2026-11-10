# Kitty: product and market research

Reviewed: `.claude/prds/kitty.prd.md`, on November 10, 2026. The PRD has not been changed.

## Summary

**Recommendation: go, in stages, with each stage proving the next one is worth building.** These recommendations assume no deadline.

- **The AI agent problem is real.** Multiple 2026 surveys show people resist letting agents pay, and that limits and approvals are what they ask for.
- **The family problem is weaker.** Existing products already cover it reasonably well.
- **The standout is reserved funds plus hard rules on the PayPal wallet**, not AI review. No product found in this brief search combines them.
- **Everything depends on one untested step:** whether your sandbox account allows multiple partial captures. Test that first.
- **PayPal does not appear to offer reserved, shared budgets** in the pages reviewed on November 10, 2026. Section 4 has the evidence and the rest of the competitor research.

## 1. Product lens

### Is the problem real?

| Claim | Verdict | Basis |
|---|---|---|
| People won't let AI agents pay without firm limits | **Supported** | Survey evidence below |
| Delegating to family gives too much access | **Partly supported** | 46% of parents caught kids spending on their cards without asking (LendingTree, 2022, dated), but products already address it |
| Owners are burdened by approving small purchases | **Unsupported** | No direct evidence found |

Survey evidence, all from secondary reports:

- **Accenture (16 countries):** 32% would delegate purchase decisions within set limits. Only 9% would allow purchases without final approval.
- **Checkout.com (six markets):** spending caps (30%) and instant revocation (29%) were the top comfort factors.
- **ACI, UK:** 43% trusted agents to respect spending caps, but only 19% trusted them to follow purchasing guidance.
- **ACI, US and UK fashion shoppers:** only 7% would let an assistant buy without approval.

**Contrary evidence:** Forrester found three-quarters of respondents were uncomfortable with autonomous agent payments even with preset limits. Checkout.com found 24% would never delegate. The market may stay small for some time, and approval steps may be essential rather than optional.

**Inference:** the ACI gap suggests people trust a hard cap more than they trust an AI's judgment. Kitty should lead with limits enforced in code and present AI review as a second layer.

### What matters most for the demo

Listings describe the judging areas as technical implementation, design, potential impact, innovation and presentation. No weights or Agentic Commerce requirements could be confirmed. PayPal's only stated core requirement is meaningful use of both PayPal and AI.

Show these moments, in order, in about two minutes:

1. **One approval** reserves the budget in real PayPal sandbox checkout.
2. **An AI agent buys something on-goal**, and a real capture appears in PayPal.
3. **An over-limit purchase is stopped by the rules**, proving the limit isn't just a prompt.
4. **An off-goal purchase is blocked by AI**, with a reason shown.
5. **The owner closes the pool**, and the unused balance is released.

Include a family member alongside the agent, because one pool shared by people and agents is the main differentiator.

### Anti-goals until demand is validated

Do not build organization features, a large marketplace or spending outside the marketplace yet. Refunds and hold refreshes do belong in the product, because real pools last weeks and "reserved" has to stay true after the 3-day honor period.

## 2. Market research

### Main competitors

| Group | Examples | What they offer | Gap Kitty could fill |
|---|---|---|---|
| Card networks | Visa Intelligent Commerce, Mastercard Agent Pay | Scoped, revocable agent credentials, with limits and merchant restrictions | Infrastructure for issuers and platforms, not a shared household budget |
| Protocols | Google AP2 | Signed mandates that work across payment rails | A standard, not a consumer product. PayPal is reported as a partner |
| Agent virtual cards | Privacy.com, Ramp, Slash, Meow, Lithic | Per-agent cards, caps, merchant locks and MCP access | Ramp, Slash and Meow target businesses. Cards are per-agent, not one pool shared with people |
| Family money apps | Greenlight, Apple Card Family, Cash App Families | Per-member limits, category controls, approvals in some products | Built for kids or partners, with no AI agents found |
| **PayPal itself** | Agent Ready, Store Sync, Agent Toolkit | Agent payment acceptance for merchants and merchant-side checkout tokens. Buyer-set agent limits were reported by third parties but not found in PayPal's documentation (section 4) | **Biggest risk, and also a pitch angle** |

Payman, Skyfire, Crossmint, Revolut and PayPal's family features are covered in section 4. Most competitor details come from vendor or third-party pages, and vendors' claims have not been independently tested.

### What would make Kitty stand out

These are inferences from the table above:

1. **Reserved funds.** Most agent controls cap what may be spent. Kitty also holds the money at approval time, so an agent has a real, bounded budget.
2. **One pool for people and agents.** A household budget with a teen and an agent side by side is the combination not found elsewhere.
3. **No new card or account.** It runs on the PayPal wallet people already have.
4. **Layered enforcement.** Hard rules in code, then AI goal review, with a reason recorded for every decision.

Position it as a consumer layer showing how PayPal's agent controls could work for households, not as a rival to PayPal. Avoid claiming "first" or "only". Absence from the pages reviewed does not prove a product doesn't exist, and section 4 narrows these points.

### Risks

- Partial captures may be unavailable in the sandbox, which would remove the reserved-funds story.
- Authorization holds are only firmly honored for 3 days, so "reserved" needs careful wording.
- One-merchant marketplaces limit real-world use, and judges may ask about this.
- UPI claims in the pitch remain unverified.

## 3. Recommended PRD changes

Awaiting your approval. None of these have been applied.

1. **Order the milestones by what must be proven first:** pool feasibility, demand validation, shared family and agent pools, pools that stay reliable for their full term, public demo or hackathon submission, then the organization tier. Each stage must pass before the next starts. Remove dates from the plan.
2. **Move demand validation before the full build.** Interview five people from each user group, using the prototype from the feasibility stage. Stop or change direction if the target isn't met.
3. **Keep both user groups, and let the interviews choose the lead.** Use one shared story until then: a parent delegates a grocery budget to an AI agent and a teen. Make whichever group shows stronger demand the primary user.
4. **Simplify the rules, and add what long pools need.** Merge delegation modes into the approval threshold, where $0 means every purchase needs approval. Add refunds and hold refreshes to the MVP.
5. **Reword the hypothesis** around people being *willing to delegate* with hard limits, rather than spending being "safe".
6. **Strengthen the success measures.** Make the interviews a stage gate, with at least 3 of 5 per group. Add a measure of how many prototype users create a pool and delegate spending, with the target TBD. Set the AI review target after building a labeled test set.
7. **Complete the competitor research before finalizing the positioning.** Cover Payman, Skyfire, Crossmint, Revolut and PayPal's family features, and check PayPal's current agent controls in its own documentation. Reconsider Kitty's angle if PayPal already offers reserved, shared budgets.
8. **Plan for the one-merchant limit.** Keep outside merchants out of the MVP, but add an open question on whether separate purchase units or a PayPal platform setup could support several real merchants.
9. **Update Evidence, Risks and Open Questions** with the surveys and competitors above, name PayPal's own agent controls as a risk, and remove "deadline" from the hackathon question. Answer the legal question before any live payments, and decide on sponsor tools only after reading their requirements.

## 4. Competitor and PayPal follow-up (step S15)

Researched November 10, 2026. Each claim links to the page it came from. "Doesn't say" means the pages reviewed don't address the point, not that the feature doesn't exist. Anything not confirmed on the company's own current page is marked **[verify]**.

### Does PayPal already offer reserved, shared budgets?

**No. None of the PayPal pages reviewed describes a budget that is both reserved and shared, or a buyer-set spending limit for AI agents.** PayPal has separate pieces, and none of them does what Kitty proposes:

| Piece | What PayPal offers | How it differs from Kitty |
|---|---|---|
| Reserving money | [Two-step payments](https://developer.paypal.com/payment-methods/auth-honor) (updated July 8, 2026) let a merchant hold a buyer's funds for 29 days, with a 3-day honor period, repeat reauthorization and partial captures once enabled on the account | A merchant API, and the building block Kitty uses. It is not a budget product for buyers. "Reserved" is only firm during an honor period |
| Sharing money | [PayPal Pools](https://www.paypal.com/us/cshelp/article/what-are-pools-help1197) collect contributions for group purchases, up to $20,000 per pool and 5 active pools. [The terms](https://www.paypal.com/us/legalhub/paypal/pool-tnc?locale.x=en_US) (updated November 14, 2024) make a pool a subaccount of the creator's Balance account, meant for short-term use | Money flows in to one person, who owns it and may need to move it to their balance before spending. Neither page describes members spending from a pool, per-member rules or agents |
| Family access | US individuals must be [at least 18 or the age of majority](https://www.paypal.com/us/legalhub/paypal/useragreement-full) (updated November 4, 2026). The closest family product is the [Venmo Teen Account](https://newsroom.paypal-corp.com/2023-05-22-Introducing-the-Venmo-Teen-Account) (2023): parents oversee up to five teens, see balances and lock debit cards | A teen account on Venmo, with no shared budget or agents in the announcement. No PayPal-branded family account turned up in this research |

**Limits of this answer.** PayPal's [Agent Ready docs page](https://docs.paypal.ai/growth/agentic-commerce/agent-ready) now returns a 404, so it could not be read. PayPal is moving quickly here, so recheck before the submission in step S55.

### What PayPal's agent controls do

| Product | What PayPal's own pages say | Buyer-set limits? |
|---|---|---|
| [Agent Toolkit](https://github.com/paypal/agent-toolkit) | Lets agent frameworks call merchant APIs such as invoices, orders, refunds, disputes and subscriptions. Configuration turns each action on or off. Reviewed the full tool list and the setup section of the README | None in the tools or configuration reviewed |
| [ChatGPT checkout through Braintree](https://developer.paypal.com/agent-ready/agentic-commerce-protocol) (updated October 29, 2026) | A one-time-use token limited by merchant, maximum amount, currency and expiry, which the merchant validates | No. This is the confirmed form of the "time-bound tokens" reported earlier, and it covers one checkout on the merchant side |
| [AP2 support](https://developer.paypal.com/community/blog/PayPal-Agent-Payments-Protocol/) (blog, September 16, 2025) | Signed mandates. An Intent Mandate can pre-approve conditions such as budget, categories or timing. The post describes pilots and an incremental rollout | A protocol concept only. No shipped PayPal screen or limit is described |
| [Agent Ready launch](https://newsroom.paypal-corp.com/2025-10-28-PayPal-Launches-Agentic-Commerce-Services-to-Power-AI-Driven-Shopping) (October 28, 2025) | Lets existing PayPal merchants accept payments on AI surfaces, with fraud and buyer protection | Merchant-side |
| Shopper guides ([agentic commerce](https://www.paypal.com/us/money-hub/article/agentic-commerce-explained), March 5, 2026; [AI checkout security](https://www.paypal.com/us/money-hub/article/ai-checkout-security-guide), April 22, 2026) | Advise people to choose providers with spending limits or a final approval, and to set limits where available | Advice about AI providers, not a PayPal setting |

### The other products

**Payman has moved to banks.**
- Its [site](https://www.paymanai.com/) now sells AI agents to banks and credit unions, with demo requests only.
- It shows approval by a code sent to the user's phone and a policy layer the model cannot override. The regulated institution holds the funds.
- It doesn't say anything about spending caps or shared budgets. Its old `docs.paymanai.com` host no longer resolves.
- [Directory listings](https://dupple.com/reviews/payman) describe per-agent wallets with caps and approvals, probably an earlier product **[verify]**.

**Skyfire is identity and payments for agents buying digital services.**
- Its docs describe [token payments](https://docs.skyfire.xyz/llms.txt) that let developers sell APIs, tools and content to agents. Its [product page](https://www.skyfire.xyz/product) invites people to join a beta.
- [Each agent has its own wallet and belongs to exactly one user](https://docs.skyfire.xyz/docs/platform-structure.md). Users [pre-fund wallets](https://docs.skyfire.xyz/docs/wallet-funding.md) by card or USDC, and by ACH or wire on a paid subscription.
- Each [payment token carries a set amount](https://docs.skyfire.xyz/docs/pay-token.md).
- The product page offers per-agent spending limits, but the [docs page for them](https://docs.skyfire.xyz/docs/agent-spending-limits) now returns a 404, so their status is unconfirmed **[verify]**.
- It doesn't say anything about human approval or budgets shared between people.

**Crossmint is the closest match technically, but it is a developer platform.**
- Developers embed it in their own apps. [Users approve a spending authorization](https://docs.crossmint.com/agents/how-agents-pay) with an amount, an expiry and an optional merchant, and can cancel it.
- [One authorization can cover several purchases](https://www.crossmint.com/products/agentic-cards) within the approved budget, on eligible Visa and Mastercard cards.
- The [order intent response](https://docs.crossmint.com/solutions/ai-agents/agent-wallets/virtual-cards) includes `spent`, `reserved` and `available` amounts, but the page doesn't explain `reserved`. The same page says the encrypted-card rail doesn't enforce the allowance.
- Agent wallets add a spend cap, allowed counterparties and a time window, enforced onchain.
- Each intent belongs to one user. The pages don't describe one budget shared by several people or agents, or a release date.

**Revolut covers families well, using pre-funded accounts.**
- [Kids & Teens](https://www.revolut.com/legal/revolut-under18/) (terms updated September 25, 2026) is a sub-account of the parent's account. A purchase is declined if the sub-account is short, even when the parent has funds.
- [Parents get](https://www.revolut.com/en-RO/revolut-kids-and-teens-parent-and-guardians) spending limits, card freezing, instant notifications and controls on gambling, cigarettes and alcohol.
- [Joint accounts](https://www.revolut.com/joint-accounts/) give two people shared money, matching cards and budgeting Pockets.
- Agent payments are separate. [Revolut Pay added AP2 support](https://fintech.global/2026/01/19/revolut-pay-targets-agentic-commerce-with-ap2-integration/) for the UK and EEA (trade press, January 19, 2026), and it [joined a Visa agent payment trial](https://www.crowdfundinsider.com/?p=308247) (trade press, September 2026) **[verify]**.
- No page reviewed connects family accounts to agents.

### Other entries in this hackathon

One search found four public projects. This is not a full list, and only their READMEs were reviewed.

| Project | Audience | Approach |
|---|---|---|
| [Allowance (anishalx)](https://github.com/anishalx/allowance) | Households, such as a $60-a-week grocery agent | Plain-English rules, a rules engine and AI auditor, a saved PayPal wallet, and Payouts to the store |
| [Allowance (deevj37378)](https://github.com/deevj37378/paypal-hackathon) | AI agent owners | Code-enforced rules, chat approvals, revocable permissions, a saved PayPal wallet and Payouts |
| [Mandate](https://github.com/deepakkushwaha7/mandate-paypal-agent) | Online brands reordering supplies | Spending caps, many agents under one mandate, and an authorization per payment so it can be undone |
| [SpendConsent](https://github.com/abhishekruby/spendconsent) | Small businesses | The owner approves one exact cart before checkout |

A keyword check of each README found no PayPal hold over a whole budget spent in pieces, and no budget shared by people and agents. The "reserve" step in the second Allowance is its own ledger, not a PayPal hold.

### What this means for Kitty

These are inferences for the product direction decision in S18:

1. **The positioning survives.** Kitty can still be a household layer on PayPal, with no need to change direction because of PayPal's current products.
2. **"Reserved funds" alone is not distinctive.** Revolut and Skyfire set money aside by pre-funding, and Crossmint offers one approval for many purchases. Kitty's narrower claim is a hold on the existing PayPal wallet, with no money moved to a new account, spent by people and agents under separate rules.
3. **Rules plus AI review will not stand out in this hackathon.** At least four entries have some form of limit or approval, and one targets households directly. The demo should lead with the hold and the shared pool, and step S05 still has to prove the hold works.
4. **The word "pool" collides with PayPal Pools.** S18 should decide whether to keep it, because users must never mistake Kitty for a PayPal product.
5. **Teen members can't be required to have PayPal accounts,** because of PayPal's age requirement. The owner's account has to carry the payment.

### Answers to the PRD's competitor questions

- **What do Payman, Skyfire, Crossmint, Revolut and PayPal's family features offer?** See "The other products" and the family row in the first table. None was found combining a reserved budget with one pool for people and agents.
- **What do PayPal's current agent controls do?** They are merchant tools, merchant-side checkout tokens and a protocol-level mandate concept. No buyer-set limit was found.
- **Does PayPal already offer reserved, shared budgets?** Not in the pages reviewed. Recheck before submission.

## Sources

Sources for section 4 are linked next to each claim.

**Hackathon**
- [PayPal AI Hackathon blog](https://developer.paypal.com/community/blog/PayPal_AI_Hackathon): dates and prizes
- [Third-party listing](https://coursejoiner.com/hackathon/paypal-ai-hackathon-2026/): deadline time and judging areas, unconfirmed by PayPal
- Devpost pages returned HTTP 403 and could not be read

**Demand**
- [Accenture report coverage](https://www.artificialintelligence-news.com/news/ai-shopping-agents-consumer-trust-accenture-report/)
- [ACI on AI shopping autonomy](https://letsdatascience.com/news/aci-survey-finds-limits-on-ai-shopping-autonomy-710dc1a1)
- [Consumers reject delegating payments](https://letsdatascience.com/news/consumers-reject-delegating-payments-to-ai-agents-447f7acd)
- [Checkout.com findings](https://cmotech.uk/story/ai-shopping-adoption-outpaces-trust-checkout-com-finds)
- [Consumer and merchant expectation gap](https://stellagent.ai/insights/agentic-commerce-consumer-merchant-expectation-gap)
- [LendingTree parents survey, 2022](https://prnewswire.com/news-releases/46-of-parents-say-their-child-used-their-credit-or-debit-card-without-permission-racking-up-500-301494802.html)

**Competitors**
- [Visa, Mastercard and Stripe comparison](https://nevermined.ai/blog/visa-vs-mastercard-vs-stripe) (vendor blog)
- [Agentic spend management overview](https://www.apideck.com/blog/agentic-payments-spend-management-ai-agents) (vendor blog)
- [Privacy.com for AI agents](https://privacy.com/ai)
- [Ramp agent cards](https://ramp.com/blog/virtual-cards-for-ai-agents)
- [Slash agent cards](https://www.slash.com/blog/corporate-cards-ai-agents)
- [Meow spend controls](https://www.meow.com/blog/spend-controls-ai-agents-caps-mcc-locks-approval-ladders)
- [Lithic agentic solutions](https://www.lithic.com/solutions/agentic)
- [Greenlight spend controls](https://help.greenlight.com/hc/en-us/articles/4403845741851)
- [Apple Card Family](https://apple.com/apple-card/family/)
- [Cash App Families comparison](https://greenlight.com/cash-app-vs-greenlight) (competitor page)

**PayPal's agent work**
- [PayPal on AI shopping protocols](https://newsroom.paypal-corp.com/2026-01-22-Making-Sense-of-the-AI-Shopping-Protocol-Moment)
- [PayPal's agent authorization model](https://www.startuphub.ai/ai-news/artificial-intelligence/2026/paypal-s-agent-authorization-model-explained)
- [American Banker on PayPal's agentic bets](https://www.americanbanker.com/payments/news/paypal-targets-travel-as-an-early-use-for-agentic-ai)
