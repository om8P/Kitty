# Judge notes (template)

A template only. The filled-in copy holds the access code and the sandbox
login, so it lives **outside this public repo**, in the judges-only field of
the Devpost submission or a private note. Never commit a filled-in copy.

## Open Kitty

1. Go to `<HOSTED URL>` (for example `https://<name>.onrender.com`).
   The free host may be waking up: the first load can take up to a minute.
2. Enter the access code: `<ACCESS CODE>`.
3. Kitty makes a fresh demo household for you, with an owner (Alex), a teen
   (Sam) and a shopping agent. Nobody else sees it, and nothing you do there
   touches real money.

## Approve at PayPal (sandbox)

Creating a pool sends you to PayPal's **sandbox** site, once. Sign in there
with the shared sandbox buyer account. It holds no real money and is not a
Kitty login.

- Email: `<SANDBOX BUYER EMAIL>`
- Password: `<SANDBOX BUYER PASSWORD>`

## A five-minute path

1. As Alex, create a pool (the preview shows how the limits share it), and
   approve it at PayPal.
2. Switch to Sam with the persona switcher and buy something within the rules.
3. As Sam, try a store or amount the rules don't allow. Kitty stops it before
   any AI call.
4. Try something off the pool's goal. The AI check flags or blocks it.
5. As Alex, start the shopping agent with a short task, then approve or deny
   what waits in the ledger.
6. Close the pool. The unspent hold is released at PayPal.

## Limits for the shared demo

Each household gets 40 AI purchase reviews and 5 agent runs a day, inside
Groq's free plan. Past either, purchases still work but go to the owner for
approval, and the agent says it is at its limit.
