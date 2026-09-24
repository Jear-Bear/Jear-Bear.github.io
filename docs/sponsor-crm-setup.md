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

Later phases add more (listed in their sections): a KV namespace for the
Claude connector's OAuth tokens (Phase 3), `CRM_INGEST_KEY` for the daily
stats history, and the existing `YT_API_KEY` copied to the Worker (Phase 4).

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

---

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
| GitHub Actions | Free for public repos | A deploy takes about a minute |

On the free plan nothing is ever billed: past a limit, requests fail until the
daily reset (00:00 UTC).

## Backups

**Settings → Export** downloads everything as `.xlsx` or JSON (including
archived records and the timeline). Nothing is ever hard-deleted in the app:
records are archived and can be restored.
