# Sponsor CRM setup

The sponsor CRM ("Sponsor desk") is a private app at
`https://www.jareddesu.com/sponsorships/manage/`. The page itself is static
(GitHub Pages) and shows nothing until you sign in. All data lives in a
Cloudflare D1 database behind a Cloudflare Worker (`workers/sponsor-crm`), so it
syncs across your devices. Everything runs on free plans: Cloudflare Workers
Free, D1 Free and GitHub Actions (free for public repos).

You need to do this once. It takes about 20 minutes.

> This file is public (the repo and site are public). It contains no secrets.
> Never paste a password, key or token into any file in this repo. CRM data,
> finances and email content never go in the repo either, not even encrypted:
> they only ever live in D1.

---

## What you'll set up

| Where | What | Why |
|---|---|---|
| Cloudflare | A free account and a `workers.dev` subdomain | Hosts the Worker and the D1 database |
| Cloudflare | An API token | Lets the GitHub Action deploy |
| GitHub → Settings → Secrets and variables → Actions | `CLOUDFLARE_API_TOKEN` | The token above |
| 〃 | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| 〃 | `SPONSOR_MANAGEMENT_PASSWORD` | The CRM password (the source of truth; the Action copies it to the Worker) |
| 〃 | `CRM_SESSION_KEY` | Signs login sessions |
| 〃 | `CRM_INGEST_KEY` (optional) | Lets the stats Action send daily history (see Insights) |

Later phases add more (listed in their sections): a KV namespace for the
Claude connector's OAuth tokens (Phase 3), the existing `YT_API_KEY` copied to
the Worker, and `CRM_INGEST_KEY` for the daily stats history (Insights).

## 1. Create the Cloudflare account and subdomain

1. Sign up at <https://dash.cloudflare.com/sign-up> (free plan; no card needed).
2. Left sidebar → **Compute (Workers) → Workers & Pages**. The first time, it
   asks you to pick a **workers.dev subdomain**, e.g. `jareddesu`. Your Worker
   will live at `https://sponsor-crm.<subdomain>.workers.dev`.
3. Copy your **Account ID**: it's on the Workers & Pages overview (right side)
   and in the URL (`dash.cloudflare.com/<account id>/…`).

Your DNS stays at Namecheap; nothing about the website changes.

## 2. Create the API token

1. <https://dash.cloudflare.com/profile/api-tokens> → **Create Token**.
2. Use the **Edit Cloudflare Workers** template.
3. Under **Permissions**, add one more row: **Account → D1 → Edit**.
4. **Account Resources**: include only your account. **Zone Resources**: you
   can set this to "All zones from an account" (there are none) or remove it.
5. **Continue to summary → Create Token**, and copy the token. You only see it once.

## 3. Make the password and session key

Run these on your computer (macOS/Linux terminal):

```sh
openssl rand -base64 24   # SPONSOR_MANAGEMENT_PASSWORD (or use a password manager: 16+ random characters)
openssl rand -base64 48   # CRM_SESSION_KEY
```

Save the password in your password manager. GitHub won't show it again.

## 4. Add the GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**,
once for each: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`SPONSOR_MANAGEMENT_PASSWORD`, `CRM_SESSION_KEY`.

## 5. Deploy

Repo → **Actions → Sponsor CRM deploy → Run workflow** (on `main`). It:

1. finds or creates the `sponsor-crm` D1 database,
2. applies the schema migrations,
3. deploys the Worker,
4. copies the password and session key into the Worker as secrets.

The **Deploy** step's log shows the Worker's address, e.g.
`https://sponsor-crm.jareddesu.workers.dev`. After this, the Action runs by
itself whenever the Worker code changes on `main`.

Check it: open `https://sponsor-crm.<subdomain>.workers.dev/api/health`. It
should say `{"ok":true,"configured":true}`.

## 6. Point the page at the Worker

In `sponsorships/manage/index.html`, replace `YOUR-SUBDOMAIN` in **both**
places (the `Content-Security-Policy` line and the `crm-api` line) with your
subdomain, and commit. (Or just tell Claude the address.) The address isn't a
secret; the password protects the data.

## 7. Sign in and import your tracker

1. Open `https://www.jareddesu.com/sponsorships/manage/` and sign in.
2. **Settings → Import a tracker…** and choose your `.xlsx`. The app reads the
   Pipeline, Brands, Rate card, Dashboard (monthly targets) and Lists tabs,
   shows how each column maps and a preview, and imports only when you press
   **Import**. The file is read in your browser; only the rows are sent.
3. Check the rate card numbers in the preview (you can edit them there).

Re-importing skips deals that are already in the CRM (same company, package
and slot), so it's safe to run again.

## 8. Put the plan on the calendar

The plan's items (monthly objectives, the week-by-week checklist, recurring
blocks like the Wednesday sales block, publish dates, month-end KPI gates, the
go-full-time check and the trip) come from a private plan file (`.json`) that
Claude generates from your plan document. It's never committed.

**Settings → Plan → choose the file.** Importing again only adds what's
missing and never overwrites anything you've moved or completed. Plan items
can be moved, resized, completed, skipped, cancelled or hidden, but not
deleted. The same import adds the plan's videos to **Videos**.

---

## Claude connector

The same Worker serves a remote MCP server at `/mcp` for Claude, protected by
OAuth (tokens in the `sponsor-crm-oauth` KV namespace, which the deploy
creates). How to add it and the scheduled-task prompts:
[`docs/sponsor-crm-claude.md`](sponsor-crm-claude.md). What Claude files shows
up under **Review**.

## YouTube uploads

**Videos → Uploads** lists the channel's public uploads from the YouTube Data
API, using the same `YT_API_KEY` GitHub secret as the stats Action (the deploy
copies it to the Worker). Tap **Refresh from YouTube** to update the list and
view counts. Drag an upload onto a planned video, or use **Assign…** to link it
to a video or a sponsor deal. Linking to a deal with no video yet reuses a
planned video published within three days of the upload, or creates one.

## Insights (rate check, milestones, go full-time)

The **Insights** tab and the top of the **Dashboard** compute everything in
code (`scripts/manage/insights.js`, shared with Claude's connector):

- **This week** (dashboard): the week's calendar tasks as a checklist, a ring
  for pitches against the weekly target, the streak of 5-pitch weeks, and
  milestone stamps.
- **Monday insight** (dashboard): Claude's weekly note, with earlier ones kept.
- **Rate check**: the plan's three raise rules. For "three sponsored videos
  beat their estimate", set a **30-day view estimate** on each video (Videos →
  open a video) and link its YouTube upload. The Worker records each upload's
  views once it's 30 days old.
- **Channel milestones**: subscriber and monthly-view projections, with the
  method shown.
- **Go full-time**: enter **Your numbers** (take-home pay, expenses, savings,
  tax set-aside, health insurance) and each month's AdSense, affiliates,
  memberships and other income. Paid deals come from Payments. These numbers
  are stored only in D1, never in the repo, the public stats file or logs.
  The plan's scenarios come from the plan file (Settings → Plan).

### Daily history from the stats Action (optional, recommended)

A daily cron on the Worker (13:40 UTC) refreshes the uploads and reads daily
views and the subscriber count from the public `stats.public.json`. For
subscriber gains and losses by day (a better subscriber projection), the
**Sponsor stats** Action sends its private analytics straight to the Worker:

1. Make a key: `openssl rand -base64 48`.
2. Add it as a GitHub secret named `CRM_INGEST_KEY`.
3. Run **Actions → Sponsor CRM deploy** (copies the key to the Worker), then
   **Actions → Sponsor stats → Run workflow**.

The history is written only to the runner's temporary folder, sent over
HTTPS with the key, and never printed or committed. Without the key the step
is skipped. To stop it, delete the secret.

## Deal dates, invoices and tracked links

- **Contract dates**: a deal's script due, draft due, exclusivity end and
  usage-rights end show on the calendar. The exclusivity end is when you can
  pitch that brand's competitors.
- **Invoices**: fill in **Settings → Invoices** once (your name, email,
  address, how to pay you, terms, number prefix). On a Negotiating, Won or
  Delivered deal, **Create invoice** numbers it, records it under Payments as
  invoiced, and opens the print dialog; choose "Save as PDF". Reprint from the
  payment. The 30-day chase reminder uses the invoice date.
- **Tracked links**: on a deal, **New tracked link** makes
  `https://www.jareddesu.com/go/<name>` for the video description. The site's
  404 page forwards `/go/…` to the Worker, which counts the click (a number
  per day; no IPs or cookies) and redirects to the sponsor. `utm_*`
  parameters pass through. Clicks show on the deal, in Insights, and in the
  30-day recap. Archiving a link stops it redirecting.

## Pitching, recaps and the public sponsor page

- **Write pitch…** on a Researching or pitched deal fills a template (edit
  them in **Settings → Pitch templates**) with live numbers. **Open in
  Gmail** starts a draft for you to send; **Mark as pitched** records the
  template for **Insights → Pitch performance**. **Ask Claude to draft it**
  queues a personalized Gmail draft for Claude's next morning run.
- **Write 30-day recap…** on a Delivered or Paid deal fills in views at 30
  days (vs the estimate), clicks on its tracked link and a renewal offer.
- **Settings → Avoid list** is what Claude skips when prospecting.
- The public sponsor page shows **sponsor slots by month** from the Worker's
  `/public/availability` (counts only: no brands, titles or prices), and its
  inquiry form also files the inquiry in **Review** through `/public/inquiry`
  (rate-limited per hashed IP and per day; the form still emails you through
  Web3Forms). If the Worker is down, the page and form work as before.

## Changing the password

Update the `SPONSOR_MANAGEMENT_PASSWORD` GitHub secret, then run **Sponsor CRM
deploy** again. Existing sessions keep working until they expire (12 hours) or
until you use **Settings → Sign out on every device**. Rotating
`CRM_SESSION_KEY` the same way also signs out every device.

## How sign-in is protected

- The password is checked by the Worker in constant time. Five wrong tries from
  one address lock it out for 15 minutes (doubling each time, up to a day);
  30 wrong tries from anywhere within an hour lock all sign-ins for an hour.
- A successful sign-in returns a signed session token that expires after 12
  hours. It's kept in the tab's `sessionStorage`, so closing the tab signs out.
- The Worker only answers browsers on `https://www.jareddesu.com` (and
  `localhost` for development).
- The page loads scripts only from this site, can only talk to the Worker,
  refuses to run inside a frame, and never renders stored text as HTML.
- The page is `noindex` and linked from nowhere. It isn't listed in
  `robots.txt`, which would advertise it; the password is the real protection.

## Running it locally

Needs Node 20+.

```sh
cd workers/sponsor-crm
npm install
cp .dev.vars.example .dev.vars      # throwaway local password and key
npm run dev                          # applies migrations to a local D1, serves on :8787
```

In another terminal, from the repo root:

```sh
python3 -m http.server 8765
```

Open <http://localhost:8765/sponsorships/manage/>. On `localhost` the page talks
to the local Worker automatically. Local data lives in
`workers/sponsor-crm/.wrangler/` (ignored by git).

## Free-plan limits (and why they're fine)

| Service | Free limit | This app |
|---|---|---|
| Workers | 100,000 requests/day, 10 ms CPU per request | One person: a few hundred to a few thousand requests a day. Spreadsheet parsing and export run in the browser. |
| D1 | 5 million rows read and 100,000 written per day, 5 GB | Tiny |
| Subrequests | 50 per request (each D1 query counts; a batch counts once) | Imports check everything in one batch and write in one batch |
| GitHub Actions | Free for public repos | A deploy takes about a minute |

Calendar libraries (FullCalendar 7 standard, MIT, and `temporal-polyfill`,
MIT) are vendored in `vendor/fullcalendar/` and load only when you open the
calendar. SheetJS (Apache-2.0) is in `vendor/sheetjs/`.

On the free plan nothing is ever billed: past a limit, requests fail until the
daily reset (00:00 UTC).

## Backups

**Settings → Export** downloads everything as `.xlsx` or JSON (including
archived records and the timeline). Nothing is ever hard-deleted in the app:
records are archived and can be restored.
