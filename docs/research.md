# Kitty: product and market research

Reviewed: `.claude/prds/kitty.prd.md`, on November 10, 2026. The PRD has not been changed.

## Summary

**Recommendation: go, in stages, with each stage proving the next one is worth building.** These recommendations assume no deadline.

- **The AI agent problem is real.** Multiple 2026 surveys show people resist letting agents pay, and that limits and approvals are what they ask for.
- **The family problem is weaker.** Existing products already cover it reasonably well.
- **The standout is reserved funds plus hard rules on the PayPal wallet**, not AI review. No product found in this brief search combines them.
- **Everything depends on one untested step:** whether your sandbox account allows multiple partial captures. Test that first.

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
| **PayPal itself** | Agent Ready, Store Sync, Agent Toolkit | Reported buyer limits, time-bound tokens and agent payment acceptance | **Biggest risk, and also a pitch angle.** Current product status is unconfirmed |

Not covered: Payman, Skyfire, Crossmint, Revolut family accounts and PayPal family features. Searches returned nothing usable. Most competitor details come from vendor or third-party pages, and vendors' claims have not been independently tested.

### What would make Kitty stand out

These are inferences from the table above:

1. **Reserved funds.** Most agent controls cap what may be spent. Kitty also holds the money at approval time, so an agent has a real, bounded budget.
2. **One pool for people and agents.** A household budget with a teen and an agent side by side is the combination not found elsewhere.
3. **No new card or account.** It runs on the PayPal wallet people already have.
4. **Layered enforcement.** Hard rules in code, then AI goal review, with a reason recorded for every decision.

Position it as a consumer layer showing how PayPal's agent controls could work for households, not as a rival to PayPal. Avoid claiming "first" or "only". The search was brief, and PayPal's own controls are unconfirmed.

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

## Sources

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
