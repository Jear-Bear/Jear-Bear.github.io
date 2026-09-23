# Sponsor stats setup

`/sponsorships/` reads `data/sponsorships/stats.public.json`. A GitHub Action
(`.github/workflows/sponsor-stats.yml`) refreshes that file daily from the
YouTube Data API v3 and the YouTube Analytics API. Until the steps below are
done, the page shows the seeded values from the Sep 23, 2026 Studio export.

You need to do this once. It takes about 20 minutes.

> This file is public (the repo and site are public). It contains no secrets.
> Never paste a key, client secret or token into any file in this repo.

---

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in with the Google
   account that owns the まだまだJared channel.
2. Project picker (top bar) → **New project** → name it e.g. `jareddesu-sponsor-stats`
   → **Create**. Make sure it's selected afterwards.

Use a project just for this, so its keys and clients can't touch anything else.

## 2. Enable both APIs

**APIs & Services → Library**, then search for and **Enable** each one:

- **YouTube Data API v3**
- **YouTube Analytics API**

## 3. Create the API key (public data)

1. **APIs & Services → Credentials → Create credentials → API key**.
2. Open the new key and **edit** it:
   - **API restrictions → Restrict key → YouTube Data API v3** only.
   - Leave application restrictions at **None**. GitHub's runners don't have
     fixed IPs, and the key is only ever used server-side.
3. Copy the key; this is `YT_API_KEY`.

## 4. Configure the OAuth consent screen

In **Google Auth Platform** (older consoles call this **APIs & Services →
OAuth consent screen**):

1. **Branding**: app name `JaredDesu sponsor stats`, your email as the
   support and developer contact. Save.
2. **Audience**: user type **External**.
3. **Data access → Add or remove scopes**: add
   `https://www.googleapis.com/auth/yt-analytics.readonly` (search
   "yt-analytics.readonly"). Add nothing else. Save.
4. **Audience → Publishing status → Publish app** so it says
   **In production**.

> ⚠️ **This step matters.** In **Testing**, Google expires refresh tokens after
> **7 days**, and the Action will start failing a week later. In production
> the token keeps working. You don't need Google's verification for an app
> only you use: when you sign in you'll see "Google hasn't verified this app".
> Click **Advanced → Go to JaredDesu sponsor stats (unsafe)**. That's
> expected, because you are the developer.

## 5. Create a Desktop OAuth client

1. **Clients** (or **Credentials → Create credentials → OAuth client ID**).
2. Application type: **Desktop app**. Name: `sponsor-stats`. **Create**.
3. Copy the **Client ID** (`YT_OAUTH_CLIENT_ID`) and **Client secret**
   (`YT_OAUTH_CLIENT_SECRET`).

## 6. Get the refresh token (run the helper locally)

You need Node 20 or newer on your own computer. From the repo root:

```sh
YT_OAUTH_CLIENT_ID="…" YT_OAUTH_CLIENT_SECRET="…" node scripts/get-refresh-token.mjs
```

1. Open the printed URL, sign in with the account that owns the channel,
   and pick the まだまだJared channel if Google asks.
2. Accept the unverified-app warning (see step 4) and allow
   "View YouTube Analytics reports for your YouTube content".
3. The terminal prints `✓ Token can read YouTube Analytics…` and the
   refresh token. That token is `YT_OAUTH_REFRESH_TOKEN`.

If it warns that the token expires in a few days, the consent screen is still
in Testing: publish it (step 4.4) and run the helper again.

## 7. Add the four repository secrets

GitHub → **jear-bear/jear-bear.github.io → Settings → Secrets and variables →
Actions → New repository secret**, one for each:

| Name | Value |
|---|---|
| `YT_API_KEY` | API key from step 3 |
| `YT_OAUTH_CLIENT_ID` | Client ID from step 5 |
| `YT_OAUTH_CLIENT_SECRET` | Client secret from step 5 |
| `YT_OAUTH_REFRESH_TOKEN` | Token from step 6 |

Also check **Settings → Actions → General → Workflow permissions**. The
workflow asks for `contents: write` itself, but if your org or repo policy
forces read-only, allow "Read and write permissions".

## 8. Run it

The workflow must be on the default branch (`main`) before GitHub shows it. After merging:

**Actions → Sponsor stats → Run workflow**. A green run followed by an
"Update sponsor stats" commit means it worked. The page will show "Updated
[date] · from YouTube, refreshed daily" once GitHub Pages redeploys (a minute
or two).

From then on it runs daily at 09:23 UTC.

---

## What gets published

The script writes only these fields (see `scripts/sponsor-stats.mjs`):

- **Data API (public):** subscribers, total views, video count, and for
  featured and recent videos: title, publish date, views, likes, comments.
- **Analytics API (last 28 days, ending 3 days before the run):** views split
  into long-form, Shorts and live; total views; watch time; subscribers gained;
  top 10 countries as shares of views; US+UK+CA+AU combined share.
- **Analytics API (last 90 days):** views for each featured video.

It never writes revenue, traffic sources, age/gender or retention. Those are
reserved for the future private dashboard.

## Manual values

`data/sponsorships/overrides.json` holds numbers the API can't provide (for
example **returning viewers**, which the Analytics API doesn't expose, and the
"first 5 days" views for the italki video). Any entry with a non-null `value`
overrides the same key on the page. Always set `asOf` and the `period`.

## Troubleshooting

| Symptom in the Action log | Fix |
|---|---|
| `oauth token: HTTP 400 invalid_grant` | Refresh token expired or revoked. Check the consent screen is **In production**, rerun step 6, update the secret. |
| `analytics …: HTTP 403` | Token belongs to an account/channel that doesn't own the channel. Rerun step 6 and pick the right channel. |
| `channels: HTTP 400 API key not valid` | Wrong key, or it isn't allowed to use YouTube Data API v3 (step 3). |
| `HTTP 403 quota` | Daily quota exceeded (the script uses about 5 units a day; the default quota is 10,000). Usually another use of the same project. |
| Workflow stopped running | GitHub pauses scheduled workflows after 60 days without repository activity. Re-enable it on the Actions tab. |

To test locally without writing the file:

```sh
YT_API_KEY=… YT_OAUTH_CLIENT_ID=… YT_OAUTH_CLIENT_SECRET=… YT_OAUTH_REFRESH_TOKEN=… \
  node scripts/sponsor-stats.mjs --dry-run
```
