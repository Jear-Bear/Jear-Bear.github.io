# Crossword+

Optional extras on top of the free daily crossword. Built and ready to sell
once Stripe is connected (see "Accounts and payments"); until then the page
shows the waitlist.

**What's free:** today's puzzles, kana and kanji, every level and size, plus
one My deck puzzle a day.

**What's in Crossword+:** every past puzzle, unlimited My deck puzzles, and
a few bonus puzzles a week.

**Price:** $2.99/month or $24.99/year (about $2.08/month, roughly 30% off).
Waitlist members get a founding price of $1.99/month, locked in for as long
as they stay subscribed. Ending in .99 is the standard for small
subscriptions, and keeping it under $3 makes it feel like a tip, not a bill.

**Launch when:** about 150–200 sign-ups, or 3–4 weeks of steady sign-ups
(a few a day, not one spike). Waitlists usually convert at roughly 5–15%.

## The promises (keep these)

These are on the crossword page in English and Japanese. Don't break them:

- **Today's puzzles stay free:** kana and kanji, all four levels, both sizes,
  every check and reveal.
- **No ads, no account, nothing to install** for the dailies (an account is
  only for Crossword+).
- (Changed Oct 2026: past puzzles moved into Crossword+. The page used to
  say every daily stays free; it now says today's.)
- **One email at launch.** No newsletter. Everyone can remove themselves anytime.

## How the asking works

- **Page section** "Free, and staying free" (無料) below How to play: says what's
  free, what Crossword+ might add, links YouTube channel memberships as a way to
  say thanks, and has the signup form. It never pops up.
- **Solved screen (お見事):** a short version above the Copy result / Keep
  looking buttons, on every solve. Once someone signs up it becomes a
  one-line "You're on the Crossword+ list"; "Not for me" hides it for 30
  days. It never covers the grid or interrupts a puzzle.
- Code: `scripts/crossword/plus.js`. The support link (`SUPPORT_URL`) points to
  the channel's YouTube memberships page; swap it for Ko-fi or Patreon there.

## Where the emails go

`POST /public/crossword-interest` on the sponsor Worker
(`workers/sponsor-crm/src/waitlist.js`) stores email, language, the optional
"what sounds good" picks and the date in D1 (table `crossword_waitlist`,
migration 0011). They are never in the repo. The endpoint is rate-limited
per hashed IP and per day, has a honeypot field and only accepts the site's
origin.

See them in the Sponsor desk → **Traffic** tab → **Crossword+ waitlist**:
count, last 7 days, what people want most, the list, **Copy emails** and
**Download CSV**. The CSV has each person's leave link
(`/public/crossword-leave?t=…`), which deletes them in one click.

## Bonus puzzles (the backlog)

Extra 9×9 puzzles only for Crossword+, rotating intermediate → beginner →
advanced → mixed, each with its own theme and sometimes a shape. They're
built and clued like the dailies, then **sealed**: encrypted with the sponsor
Worker's public key and committed to `data/crossword/bonus/`. The private key
was generated inside the Worker and lives only in D1, so the files in the
public repo can't be read by anyone else; at launch the Worker opens them for
subscribers. `data/crossword/bonus/index.json` lists them (no clues or
answers).

```
node scripts/crossword/cli.mjs bonus-key          # once: save the Worker's public key (key.json)
node scripts/crossword/cli.mjs bonus-draft 2      # build the next 2 into data/crossword/drafts/bonus-NNN.json
node scripts/crossword/cli.mjs bonus-publish bonus-005   # check clues, seal, add to the index
```

The Sponsor desk's waitlist card shows **Bonus puzzles ready**: the Worker
fetches each sealed file from the site and opens it, so the count is only of
puzzles it can actually read.

Add this to the nightly crossword task (after publishing the dailies):

```
7. Bonus puzzles: if the newest entry in data/crossword/bonus/index.json was made 7 or more days ago (or the file doesn't exist), run: node scripts/crossword/cli.mjs bonus-draft 2. For each draft (data/crossword/drafts/bonus-NNN.json), apply the same safety check as step 2 and write clues the same way as step 3 (its level is in the draft; mixed gets Japanese clues), then run: node scripts/crossword/cli.mjs bonus-publish bonus-NNN. Commit data/crossword/bonus/ together with the dailies.
```

## My deck

Crosswords made from your own Anki deck, on the crossword page under
**My deck**. **One a day is free** for everyone (no account; counted in the
browser), and members can make as many as they like.

- **Import:** an **.apkg** (Anki → File → Export → Anki Deck Package, or a
  deck from AnkiWeb; a whole-collection .colpkg works too), or "Notes in
  Plain Text (.txt)", a CSV, or a paste. Packages are opened in the browser
  (JSZip, sql.js and fzstd, loaded only when someone picks one): both the
  current format (`collection.anki21b`, zstd) and the older ones. A package
  with several note types gets a **Note type** choice.
- Every deck's fields differ, so the player picks which field is the
  **word**, the **meaning** (the clue) and, optionally, the **reading**. The
  page guesses first, from field names (Word, Expression, 単語; Meaning, 意味;
  Reading, 読み) and then the contents. Without a reading field it uses
  furigana like 漢字[かんじ], or the crossword's own dictionary.
- **Puzzles:** Mini or Daily, kana or kanji answers, built in the browser
  (freeform grids, only the deck's words). The deck and the puzzles stay in
  that browser; nothing from the deck is sent anywhere.
- After the free one, **Make a puzzle** points to Crossword+. Made puzzles can
  be replayed any time.

## Past puzzles (the archive)

Every day ever published stays in `data/crossword/puzzles/` (one file per
day, kana and kanji, about 100 KB) and is listed in `index.json`: about
40 MB a year, far under GitHub's 1 GB guideline for decades.

- On the page, any day before your own today is for members (🔒 in the date
  list; "Past puzzles are part of Crossword+" with a link).
- Once a day is in the past in **every** time zone, `publish` seals its file
  (encrypted for the sponsor Worker, like the bonus puzzles), so it can't be
  read from the repo either. The Worker opens it for members
  (`POST /public/plus/day`). `node scripts/crossword/cli.mjs seal-archive`
  does it by hand.
- So new puzzles can still avoid repeating recent answers, sealed days keep
  their answers as salted hashes in `sealed-answers.json` (no clues, no
  grids).
- Days from before this change are still readable in the repo's git history.
  That's fine for a soft paywall; nobody's going to solve from commit diffs.

## Telling people (without being pushy)

Mention it where people already are, once, as a question, not a sale:

**YouTube community post / pinned comment**

> Quick one: the daily kana crossword (jareddesu.com/tools/crossword) is free
> and always will be. A few of you asked for older puzzles, so I'm thinking
> about an optional Crossword+ with every past puzzle plus some bonus ones each
> week. Would you use it? If yes, there's a spot to leave your email under
> the puzzle and I'll send exactly one email when it's ready. If not, no
> worries at all, the dailies aren't going anywhere.

**Discord**

> Thinking about adding an optional Crossword+ (full archive + weekly bonus
> puzzles). The dailies stay free no matter what. If you'd want it, drop your
> email at the bottom of the crossword page, and tell me here what you'd
> actually use. Brutal honesty welcome.

**In a video** (a line, not a segment): "The crossword's free and staying
free. If you want more puzzles, there's a waitlist for an optional
Crossword+ on the page."

## The launch email (when it's ready)

Send it once, from your own address, BCC or one by one, with each person's
leave link at the bottom:

> Subject: Crossword+ is here (the one email I promised)
>
> Hi! You asked me to tell you when Crossword+ was ready. It is: every past
> puzzle and new bonus puzzles each week, for $X/month or $Y/year. [link]
>
> The daily puzzles are still free, same as always.
>
> Thanks for playing,
> Jared
>
> You won't get more emails about this. To be removed from the list right now:
> [leave link]

## Deciding whether to build it

Check the waitlist after 3 to 4 weeks next to the crossword's daily visits
(Traffic tab). A few hundred sign-ups means it's worth building payments
(Lemon Squeezy handles the overseas VAT) and moving puzzles older than 7 days
out of the public repo into the Worker. Under about 50 means keep it free and
grow the audience first.

## Accounts and payments (built)

**Signing in** (only for Crossword+; the daily puzzles never need it). An
account is an email. Two ways in, both optional, same account when the email
matches:

- **Sign in with Google** (Google's own button; the Worker checks the token
  against Google's keys and `GOOGLE_CLIENT_ID`).
- **Email link**: type your email, get a one-time link (20 minutes), sent with
  Resend. No password anywhere.

Signing in gives the browser a session (90 days; "Sign out" ends it on every
device). Code: `workers/sponsor-crm/src/plus.js`, `scripts/crossword/account.js`.

**Paying.** Signed in, a member picks $2.99/month or $24.99/year and goes to
**Stripe Checkout**. Each account gets one Stripe customer with its email, so
the subscription belongs to that email. Stripe's webhook keeps the account's
status current (renewals, failed cards, cancellations), and the page also
checks the moment they come back from Checkout. **Manage subscription** opens
Stripe's customer portal (switch month/year, update the card, cancel at the end
of the period, invoices). Card details only ever go to Stripe.
Code: `workers/sponsor-crm/src/stripe.js`.

A member is: an active (or trialing, or past-due while Stripe retries)
subscription, or **free access** you give an email in the Sponsor desk.

### Turning it on

1. **Stripe key.** Stripe → Developers → API keys. Start with the **test**
   secret key (`sk_test_…`). Add it as the GitHub secret `STRIPE_SECRET_KEY`.
2. **Google sign-in (optional).** Google Cloud console → APIs & Services →
   Credentials → Create OAuth client ID → Web application. Authorized
   JavaScript origins: `https://www.jareddesu.com` and `https://jareddesu.com`.
   Add the client ID (ends in `.apps.googleusercontent.com`; not a secret) as
   the GitHub secret or variable `GOOGLE_CLIENT_ID`.
3. **Email links (optional, but needed for anyone without Google).** Make a
   free Resend account (3,000 emails/month), add the domain `jareddesu.com`
   and the DNS records it shows, then add an API key as the GitHub secret
   `RESEND_API_KEY`. Optional variable `LOGIN_EMAIL_FROM`, e.g.
   `Jared’s Crossword <crossword@jareddesu.com>`.
4. GitHub → Actions → **Sponsor CRM deploy** → Run workflow (pushes the new
   secrets to the Worker).
5. Sponsor desk → Traffic → Crossword+ members → **Connect Stripe**. It makes
   the two prices, the portal settings and the webhook (safe to press again).
   The crossword page then shows the plans, marked "Test mode".
6. Try it with Stripe's test card `4242 4242 4242 4242`, any future date, any
   CVC. Check the account shows as paying in the desk, open Manage
   subscription, cancel, and see it end.
7. **Go live:** swap `STRIPE_SECRET_KEY` for the live key (`sk_live_…`), run
   the deploy, press **Connect Stripe** again (live mode has its own prices
   and webhook).

**Founding price for the waitlist:** in Stripe, make a coupon ($1.00 off,
forever) and a promotion code for it (e.g. `FOUNDING`). Checkout has a box
for codes, so put the code in the launch email.

**Tax:** with Stripe you're the seller, so sales tax and VAT are yours to
handle. Stripe Tax (0.5% per sale) can work it out: turn it on in Stripe and
set the GitHub variable `STRIPE_AUTOMATIC_TAX` to `true`.

**Not yet:** the desk can't refund (do it in Stripe), and turning an account
off doesn't cancel its subscription (also in Stripe).
