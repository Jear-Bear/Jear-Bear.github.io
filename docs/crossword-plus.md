# Crossword+ (waitlist stage)

Crossword+ is an idea for optional extras on top of the free daily
crossword: every past puzzle and a few bonus puzzles each week. Right now
it's only a waitlist, to see whether enough people want it before building
payments. Thinking price: about $3/month or $24/year (roughly half of NYT
Games), maybe with a founding-supporter price.

## The promises (keep these)

These are on the crossword page in English and Japanese. Don't break them:

- **Every daily puzzle stays free:** all four levels, both sizes, every check
  and reveal. Nothing that's free now moves behind Crossword+.
- **No ads, no account, nothing to install.**
- **One email at launch.** No newsletter. Everyone can remove themselves anytime.

## How the asking works

- **Page section** "Free, and staying free" (無料) below How to play: says what's
  free, what Crossword+ might add, links YouTube channel memberships as a way to
  say thanks, and has the signup form. It never pops up.
- **Solved screen:** a short question under the Copy result / Keep looking
  buttons. It shows only from your 3rd solve, at most once a day, never again
  after signing up, and not for 60 days after "Not for me". It never covers the
  grid or interrupts a puzzle.
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
