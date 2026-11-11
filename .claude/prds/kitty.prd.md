# Kitty

Shared PayPal spending pools for families and AI agents.

## Problem
People who want family members or AI shopping agents to spend on their behalf appear to face an all-or-nothing choice: share payment access, approve every purchase personally, or not delegate at all. Left unsolved, delegated spending stays risky or tedious, and many people will not let AI agents pay for anything.

## Evidence
Full findings and sources are in `docs/research.md`. Survey figures come from secondary reports.

- Supported: people resist letting AI agents pay without limits and approval. In Accenture's survey across 16 countries, 32% would delegate purchase decisions within set limits, and 9% would allow purchases without final approval.
- Supported: hard limits appear to earn more trust than AI judgment. In ACI's UK survey, 43% trusted agents to respect spending caps, and 19% trusted them to follow purchasing guidance.
- Contrary: Forrester found three-quarters of respondents were uncomfortable with autonomous agent payments even with preset limits. Checkout.com found 24% would never delegate purchases to AI.
- Partly supported: delegating to family can give too much access. 46% of parents caught kids spending on their cards without asking (LendingTree, 2022, dated), but family money apps already address much of this.
- Assumption — not validated: budget owners are burdened by approving or paying for small purchases themselves.
- Precedent, not demand evidence for PayPal users: India's UPI Circle and UPI Reserve Pay offer delegated and reserved payments. Specific UPI claims must be verified before use in the pitch.
- Existing alternatives: card network agent programs, agent virtual cards and family money apps offer limits or merchant controls. A brief search found none combining funds held on the owner's PayPal up front, one pool shared by people and agents, and the PayPal wallet.

## Users
- **Primary (equal priority, decided by the owner on 2026-11-11 after research, ADR-0008)**:
  - Household budget owners who pay for shared purchases and want family members to spend within limits.
  - People who want an AI shopping agent to buy on their behalf within firm limits.
- **Shared story**: A parent delegates a grocery budget to an AI agent and a teen.
- **Later tier**: Organizations that delegate spending to employees, departments or agents. Roadmap only; needs are TBD — needs validation via research.
- **Not for (MVP)**: Organizations, and anyone who needs to spend at merchants outside Kitty's demo marketplace.

## Hypothesis
We believe **one-approval PayPal pools with hard per-member limits and AI purchase checks** will **make people willing to delegate spending** for **household budget owners and AI agent users**.
We'll know we're right when **100% of test purchases that break a hard rule are stopped and no pool is overspent**. Whether people will actually delegate spending is not tested before launch.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Hard-rule enforcement | 100% of rule-breaking test purchases stopped | Scripted purchase scenarios against the PayPal sandbox |
| Pool integrity | 0 pools overspent | Compare each pool's approved amount with its total captured spend in the sandbox |
| Delegation follow-through | TBD — set from public demo usage | Share of demo households that create a pool and delegate spending |
| AI purchase review quality | TBD — set after building a labeled test set | Compare AI decisions with expected outcomes |

## Scope
**MVP** — In the PayPal sandbox, an owner approves a pool once. Family members and AI agents spend from it in pieces at a demo marketplace, under per-member spending limits, allowed stores and approval thresholds, where a $0 threshold means every purchase needs approval. Hard limits are enforced first, then AI reviews each purchase against the pool's stated goal and can flag or block it. The owner can see activity, approve purchases, refund purchases, keep the PayPal hold valid for the pool's full term, and close the pool to release unused funds.

**Demo moment** — A product listing tries to manipulate the AI agent or reviewer, and the hard rules still stop the purchase. User-facing text says the money is held on the owner's PayPal and does not promise a guaranteed reservation, because PayPal firmly honors a hold for only 3 of its 29 days.

**Sponsor tools in the MVP**
- Channel3 — supplies real product data for the demo marketplace and the AI agent's product search. Purchases are still paid to Kitty in the sandbox, and no real retailer order is placed.
- AG Grid — powers the owner's live ledger of every purchase, showing the member, amount, rule result, AI decision and status, with approvals handled from the ledger.

**Out of scope**
- Organization tier — roadmap only for now.
- Spending at merchants outside the demo marketplace — one PayPal authorization appears to be tied to one payee. See Open Questions.
- Payouts to separate sellers — requires a PayPal platform setup.
- Live payments — sandbox only until the legal and compliance question is answered.
- Native mobile app — a web app is enough to test the hypothesis.

## Delivery Milestones
<!-- Business outcomes, not engineering tasks. /plan turns each into a plan. -->
<!-- Status: pending | in-progress | complete -->

Milestones are ordered by what must be proven first. Each must pass before the next starts.

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Pool feasibility confirmed | A budget can be reserved once, spent in pieces and have its remainder released in the real sandbox | pending | — |
| 2 | Product direction chosen | Competitor research is finished, and the owner has confirmed the direction and the lead user group | complete | ADR-0008 |
| 3 | Shared family and agent pools | An owner can fund one pool and let family members and AI agents spend under individual rules, with off-goal or over-limit purchases stopped | pending | — |
| 4 | Reliable full-term pools | Pools stay usable for their full term, with refunds, renewed holds and clear handling of failed spending | pending | — |
| 5 | Public demo or hackathon submission | A deployed product and demo video show the complete flow working as described | pending | — |
| 6 | Organization tier | Organizations can delegate spending; scope depends on research | pending | — |

## Open Questions
- [x] Does the sandbox account support multiple partial captures, and is PayPal approval needed? Yes, with no approval (`docs/spike/S05.md`).
- [x] How many partial captures can one authorization take? At least 30, and PayPal documents no count limit (`docs/spike/S05.md`).
- [ ] Can a partly spent authorization be reauthorized, and what balance carries over?
- [ ] Can the unspent remainder be released after partial captures?
- [ ] Could separate per-merchant payments under one approval, or a PayPal platform setup, support several real merchants?
- [x] What do Payman, Skyfire, Crossmint, Revolut and PayPal's family features offer? See `docs/research.md` section 4.
- [x] What do PayPal's current agent controls do according to its own documentation, and does PayPal already offer reserved, shared budgets? If so, Kitty's positioning must be reconsidered. Answered in `docs/research.md` section 4: merchant-side controls only, and no reserved, shared budget. Recheck before submission.
- [x] What are the hackathon judging criteria, submission format and sponsor prize requirements? See `docs/hackathon-rules.md`.
- [ ] Do Channel3's terms allow its product data in a sandbox checkout where no retailer order is placed?
- [x] Does AG Grid's free edition cover the ledger, or would a paid license be needed? Yes, the free edition covers it (`docs/spike/S09.md`).
- [ ] What do organizations need, and how would that tier be packaged or priced?
- [ ] Would holding and delegating funds for others require licensing or PayPal approval? This must be answered before any live payments.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Partial captures are unavailable in the sandbox | TBD — needs validation via sandbox test | High | Test first; fall back to separately charging saved PayPal accounts, accepting the loss of reserved funds |
| A PayPal hold is firm for only 3 of its 29 days | Medium | High | Set clear pool durations, renew reservations and show failed-spend states |
| The problem is not urgent enough for one or both user groups | Medium | High | Accepted without interviews. Rely on published surveys, and have the owner confirm the direction after competitor research |
| People stay uneasy about agents paying even with limits | Medium | High | Lead with hard limits and approvals |
| PayPal's own agent controls overlap with Kitty | TBD — needs validation via PayPal documentation | High | Check PayPal's current product before finalizing positioning; present Kitty as a household layer on PayPal, not a rival |
| Existing limit and merchant-control products are good enough | Medium | Medium | Finish competitor research; focus on reserved funds and one pool shared by people and agents |
| The one-merchant limit reduces real-world usefulness | High | Medium | Be explicit about the limit; investigate multi-merchant options |
| AI wrongly allows or blocks a purchase | Medium | Medium | Hard rules are enforced independently of AI; AI can never approve extra spending |
| Malicious product text manipulates the AI review | Medium | High | Treat product text as untrusted and test against manipulation attempts |
| Hackathon rules conflict with the plan | TBD — needs validation by reading the rules | High | Read the complete rules before planning the public demo or submission |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
