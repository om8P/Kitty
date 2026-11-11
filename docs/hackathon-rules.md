# PayPal AI Hackathon rules

Summary of the [Official Rules](https://paypalaihackathon.devpost.com/rules) and the [overview page](https://paypalaihackathon.devpost.com/), read on 2026-11-10. This is a working summary in our own words, not legal text. The Official Rules win over the website if they differ (section 11), and the organizers can change them (section 11), so re-read them before submitting.

"§" means a numbered section of the Official Rules. "Overview" means the overview page.

## Read this first: the deadline

**Submissions close Thursday, Nov 12, 2026 at 12:00 pm Pacific (20:00 UTC) (§1).** That is two days after this file was written. The owner has decided to enter and to follow `plan.md`. `docs/research.md` predates this decision and still assumes no deadline. See C1.

## Dates (§1)

| Event | When (Pacific) |
|---|---|
| Submission period | Oct 1, 2026, 9:15 am to Nov 12, 2026, 12:00 pm |
| Judging period | Dec 1, 2026, 2:00 pm to Dec 15, 2026, 8:00 am |
| Winners announced | Around Dec 21, 2026, 2:00 pm |

After the submission period closes, the entry is frozen. Only rights, privacy or inappropriate-content fixes may be allowed (§5). Drafts can be saved on Devpost before then (§5).

## Requirements

### Who can enter

| Requirement | Source | Kitty status |
|---|---|---|
| Adult where you live, as an individual or team. Teams appoint one Representative | §3 | Owner to confirm |
| Not a resident of an excluded place: Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea, other US-sanctioned places, or anywhere the law bars taking part | §3 | Owner to confirm |
| Not connected to PayPal, Devpost or a judge, including immediate family and household | §3 | Owner to confirm |
| Register with "Join Hackathon" on the site | §4 How To Enter | Owner to confirm. No plan step covers this |
| No financial or preferential support from PayPal or Devpost for the project | §4 Financial or Preferential Support | Owner to confirm |

### What to build

| Requirement | Source | Kitty status |
|---|---|---|
| An app using the PayPal developer platform through the free sandbox, plus any AI tool, model or platform | §4 What to Create | Planned: S04 and S28 |
| PayPal must be central. Sponsor tools are optional | §4 What to Create | Planned |
| Must install and run consistently, and work as the video and text describe | §4 Functionality | S53 |
| New, or significantly updated during the submission period | §4 New & Existing | Met. First commit is 2026-11-09 |
| Authorized use of any third-party SDK, API or data, under its terms | §4 Third Party Integrations | Open for Channel3: S11 and S11a |
| Original work, solely owned, infringing no rights. Open source is allowed if licenses are followed and the entry builds on it | §4 Intellectual Property | See C5 and C6 |
| Free of viruses and malicious code | §7 | S51 |

### What to submit

| Requirement | Source | Plan step |
|---|---|---|
| Text description of features and functionality | §4 Submission Requirements | S55 |
| Working demo: **either** complete setup instructions in the repo **or** a hosted URL. Mockups and static prototypes fail | §4 Submission Requirements | S48, S49, S52 |
| Public GitHub, GitLab or Bitbucket repo with all source, assets and instructions | §4 Submission Requirements | S52. Repo is public |
| Open source license file, detectable and shown in the repo's About section | §4 Submission Requirements | S03, S52. **Not on `main` yet**: GitHub reports no license |
| YouTube video, public, link on the form | §4 Submission Requirements | S54 |
| Video under 3 minutes. Judges may stop there | §4 Submission Requirements | S54 |
| Video shows the project working on its intended device | §4 Submission Requirements | S54 |
| No third-party trademarks or copyrighted music or material in the video without permission | §4 Submission Requirements | See C4 |
| Identify the AI tools used and explain how | Overview, What to Submit (not in the Official Rules) | S52, S55 |
| Everything in English, or with English translations | §4 Language Requirements | S55 |

### Access for judges

| Requirement | Source | Plan step |
|---|---|---|
| Free, unrestricted access for testing until judging ends (Dec 15, 2026, 8:00 am Pacific) | §4 Testing | See C2 |
| If private, give login details in the testing instructions | §4 Testing | S49, S55. See C3 |
| With the setup route, include test accounts, keys and sandbox logins needed to run it. For special access, explain how to obtain it in the README or description | §4 Testing | See C3 |
| Judges need not test the app and may judge only the text, images and video | §4 Testing | S54 carries the most weight |

More than one entry is allowed if each is substantially different (§4 Multiple Submissions).

## Judging (§6)

**Stage one, pass or fail:** the project reasonably fits the theme and reasonably applies the required PayPal APIs or SDKs.

**Stage two, five equally weighted criteria.** Ties are broken in this order. Judging may include automated AI analysis.

1. **Technological implementation:** how thorough and skillful the PayPal and AI use is, and whether the work is real and non-trivial.
2. **Design:** a complete, coherent product, beyond a technical proof of concept.
3. **Potential impact:** a credible, specific case for a real problem and audience, backed by what is demonstrated.
4. **Innovation and idea:** how creative it is and how it differs from existing concepts.
5. **Presentation:** the video shows it working end to end and says what problem it solves, for whom and why it matters.

## Prizes (§8)

A project can win at most one Grand or one Honorable Mention prize, plus one Sponsor prize.

| Group | Prize | Award |
|---|---|---|
| Grand | 1st, 2nd, 3rd | $12,000, $8,000, $5,000 |
| Honorable Mention | Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce | $5,000 each |
| Sponsor | AG Grid 1st, 2nd, 3rd | $5,000, $2,000, $1,000 (three winners at 3rd) |
| Sponsor | APIMatic | $1,000 plus a 6-month business subscription (three winners) |
| Sponsor | Bryntum | $1,000 (three winners) |
| Sponsor | Channel3 | $1,500 |
| Sponsor | Render 1st, 2nd, 3rd | $1,000, $750, $500 in credits |

**Sponsor prize requirements:** §4 points to §8 for these, and §8 asks only that the entry use any of that sponsor's tools. No further conditions are published.

| Sponsor | Kitty |
|---|---|
| AG Grid | Eligible once S34 ships. Community edition appears to count **[verify]** |
| Channel3 | Eligible once S27 ships, which depends on S11a |
| Render | Eligible once the app is hosted on Render (S12 test deploy, S48 production). ADR-0002 moved hosting to Render on 2026-11-11 |
| APIMatic, Bryntum | Not planned |

Winners must pass identity and role verification and return forms within 10 business days. They are responsible for their own taxes and fees (§8).

## Rights granted by entering

- You keep your IP. The sponsor gets a non-exclusive license to judge the entry (§7).
- PayPal and Devpost may promote the entry and use contributors' names, likeness and voice, during the hackathon and for three years after (§7, §10).
- Entering accepts a release of liability (§9), individual binding arbitration (§13) and New York law (§13).

## Conflicts with the current plan

| ID | Severity | Rule | Conflict | Proposed handling |
|---|---|---|---|---|
| C1 | Accepted risk | §1 | The deadline is Nov 12, 12:00 pm Pacific. About 50 steps are unfinished, and S02 and S03 are not done | The owner decided to enter and follow the plan. See "Decision" |
| C1a | Resolved | §1 | S47b and S53a needed at least 3 days after a pool starts, which ends past the deadline | The waits were removed from the path to S55. The rules do not require a hold refresh, so the video must not show or imply one (§4 Functionality). S47b runs after the submission |
| C2 | High | §4 Testing | Access must last until Dec 15. Pools are capped at 28 days, so one started by Nov 12 ends by Dec 10, before judging closes. S53a's single pool can't serve judges | Judges must be able to create and approve a fresh pool with the sandbox buyer. Keep the host and PayPal sandbox app running until Dec 15 |
| C2a | Medium | §4 Testing | Free limits on Groq and Channel3 (S28, S27) can run out during judging, which sits badly with unrestricted access | Set the S49 caps per household so one judge can't exhaust the rest, and fall back to the seeded catalog |
| C3 | High | §4 Testing | The rules want access details supplied, but this repo is public and `rules.md` bars secrets. S55 assumes a judges-only field that may not exist **[verify on the submission form]** | Use the hosted route. Sandbox-only demo logins go in a private field if the form has one. If it doesn't, ask the organizers. Never put real API keys in the repo |
| C4 | High | §4 Submission Requirements | Channel3 returns real retailer products, so the video could show third-party brands and images. PayPal's own approval page will also appear | Film with the seeded catalog or brand-free products. Check with the organizers whether showing PayPal's real sandbox flow needs permission |
| C5 | Low | §4 Intellectual Property | `rules.md` styles Kitty on PayPal's look. Its limits on logos and login-like pages already address this | Keep those limits. Fonts stay under their own licenses |
| C6 | Low | §4 Intellectual Property, §11 | Much of the code is written with AI help, and the rules say work must be solely the entrant's. They allow outside technical help but don't mention AI coding | Disclose the tools (Overview). The rules ask entrants to request written clarification of ambiguous terms before the deadline (§11) |
| C7 | Resolved | §8 | Render prizes need Render. Northflank asked for a card in S12, so ADR-0002 now hosts on Render | None. Name Render in the submission's tools list |
| C8 | Low | §4 Submission Requirements | S48, S49 and S52 deliver both a hosted URL and a full setup path. The rules need only one | If time is cut, the hosted URL plus a short README is enough |
| C9 | Info | §8 | "Best Use of Agentic Commerce" bears on S18's open question of whether agents lead | Consider this at S18 |

## Decision (C1)

**2026-11-10: the owner decided to enter and follow the plan, with no scope cut.**

**2026-11-10: the owner approved removing the 3-day waits (C1a).** S50 now depends on S47a, S53a no longer waits, and S47b runs after the submission.

## What S52, S54 and S55 need

- **S52 (README):** what it is, setup, how judges get access, sandbox accounts, AI tools and how they are used, third-party services. MIT license detected and shown in About.
- **S54 (video):** under 3 minutes, public on YouTube, shows only working flows, states the problem, audience and why it matters, and follows C4.
- **S55 (submission):** join the hackathon first. Text description, repo URL, hosted URL, testing instructions, YouTube link and AI tools, all in English. Follow C3 for access details. Submit with margin before the deadline, since the organizers aren't responsible for late or lost entries (§9).
