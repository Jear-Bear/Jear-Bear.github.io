# Discord: account linking and the Activity

Players can link a Discord account to their site account. Linked players show up with their
Discord name and avatar on the leaderboard, can sign in with Discord, and can play Kana
Wordle and the daily crossword inside Discord as **Activities** (launched from a voice
channel's 🚀 button). A Discord app has one Activity, so there are three apps:

| Discord app | Client ID | Opens | Secret (GitHub) |
|---|---|---|---|
| Kana Wordle | `1572702904320659506` (`DISCORD_CLIENT_ID`) | `activity/wordle/` | `DISCORD_CLIENT_SECRET` |
| Kana Crossword | `1572762074424148198` (`DISCORD_KANA_CROSSWORD_CLIENT_ID`) | `activity/crossword/`, kana mode | `DISCORD_KANA_CROSSWORD_CLIENT_SECRET` |
| Kanji Crossword | `1572762280435650791` (`DISCORD_KANJI_CROSSWORD_CLIENT_ID`) | `activity/kanji/`, kanji mode | `DISCORD_KANJI_CROSSWORD_CLIENT_SECRET` |

The IDs are in `wrangler.toml`. Kana Wordle's app is also the one the website links accounts
and signs in with. A Discord account has the same ID in every app, so one link covers all
three. An Activity works once its app's secret is set (discord.js `apps`).

| Where | What |
|---|---|
| `workers/sponsor-crm/src/discord.js` | OAuth2 code exchange, link / unlink / sign-in, the Activity's endpoints |
| `workers/sponsor-crm/migrations/0026_discord_link.sql` | `board_profiles.discord_*`, `discord_states`, `activity_finishes` |
| `scripts/games/discord.js` | the site's side: start, finish, unlink, avatars |
| `scripts/games/board.js` | Settings → **Discord account** (Link / Unlink) |
| `scripts/games/signin.js` | **Continue with Discord** in the sign-in popup |
| `discord/index.html` | where Discord sends people back (the OAuth2 redirect) |
| `activity/wordle/`, `activity/crossword/`, `activity/kanji/`, `scripts/activity/wordle.js`, `crossword.js`, `kanji.js` | each Activity's page |
| `scripts/activity/activity.js` | what they share: Discord sign-in, the channel list, the link note |
| `scripts/activity/discord-sdk.js` | Discord's Embedded App SDK 2.5.0 (MIT), bundled |

## How it works

- **Scope:** `identify` only. The Worker keeps the Discord **ID, username and avatar hash**
  on `board_profiles`, and nothing else. Discord's access token is used once to read those
  three things. It's never stored. In the Activity it goes back to the SDK, because
  `authenticate()` needs it.
- **One Discord per account, and no merging.** A Discord account linked to someone else is
  refused ("Unlink it there first"). Signing in with a Discord that isn't linked yet is also
  refused: the person signs in with Google or email, then links Discord in Settings. No
  account is ever created from Discord, so Crossword+ (and Stripe) stay tied to the
  email account, unchanged.
- **Linking** (Settings, signed in): `POST /public/board/discord/start {mode:'link'}` returns
  Discord's authorize URL. Discord sends the person to `/discord/?code&state`, and
  `discord/finish` checks the state (one use, 10 minutes, stored hashed). It also checks that
  the same account is still signed in, then saves the link.
- **Sign-in** (sign-in popup): the same flow with `mode:'signin'`, which returns a normal site
  session for the linked account.
- **Unlink** clears the ID, username and avatar at once, and deletes that Discord account's
  Activity results. Deleting the account (Sponsor desk) deletes them too.
- **Names everywhere:** the daily post and its picture (board.js `displayName` / `avatarUrl`),
  Settings, and the Activity show the Discord username and avatar for linked players. The
  nickname becomes optional once Discord is linked.

### The Activity

Discord loads each Activity's page in its own frame at `https://<its client id>.discordsays.com`
(the page reads its client ID from that address and sends it with its sign-in code, so the
Worker uses that app's secret). Every request goes through Discord's proxy, using the
**URL Mappings** below:

- Each game page's `<base href="/.proxy/site/tools/<game>/">` makes the game's own relative
  paths (scripts, styles, word lists, puzzles) load through `/site`.
- `patchUrlMappings` sends the Worker calls through `/api`.
- The Worker allows that origin (`index.js` `allowedOrigin`).

What happens when it opens:

1. `authorize()` (identify) gives a code, `POST /public/board/activity/token` exchanges it,
   then `authenticate()`.
2. **Linked** players play as their account: dailies sync, and results count on the
   leaderboard if it's on for them.
3. **Unlinked** players can still play. Their dailies are saved in that frame only, and the
   Activity shows a short note on how to link.
4. **Who in the channel finished today:** each finished daily goes to
   `activity/finish` (checked exactly like a leaderboard result). `activity/channel`
   lists the channel's finishes, plus site results from linked players in the
   Activity who have the leaderboard on. The Worker returns only Discord IDs and results.
   Names and avatars come from the SDK (`getInstanceConnectedParticipants`). "Today" is
   each player's local date. Rows are deleted after two days, and "Remove my results from
   this channel" deletes them at once.
5. **The crossword Activities** play today's and yesterday's puzzles (mini and daily, every
   level), Kana Crossword in kana and Kanji Crossword in kanji. There's no My deck, no older days and no Crossword+ there:
   `scripts/crossword/app.js` checks `window.jdActivity` and leaves all of that out, with the
   ads and the funnel counts.
6. **Nothing else is inside:**
   - no ads, analytics, web fonts or sponsor cards
   - no Crossword+ upgrade prompts, checkout links, sign-in popup or invite links
   - no scripts from anywhere else
   
   The only link out is "Open jareddesu.com", through Discord's `openExternalLink`,
   which asks the player first.

## /leaderboard

Each app has one slash command, `/leaderboard`, answered by the Worker
(`src/commands.js`, `POST /discord/interactions`). No bot is involved: Discord sends the
command to the Worker, and the reply appears in the channel where it was run.

- **Options:**
  - `scope`: **This server** (the default in a server) or **Everyone**.
  - `period`: **Today** (Chicago's date, like the morning post), **Last 7 days** or **This month**.
  - Today shows results the way the morning post lays them out. The other two show a points table (top 15).
- **What each app covers:**
  - Kana Wordle: Kana Wordle.
  - Kana Crossword: the crossword's kana puzzles.
  - Kanji Crossword: its kanji puzzles.
- **Who appears:** only players who turned the leaderboard on, by their Discord name or
  nickname, as plain text (`allowed_mentions: { parse: [] }`).
  - **This server** means players seen in that server. Discord doesn't let an app without a
    bot list a server's members, so a player counts there once they've played an Activity there
    or run `/leaderboard` there (`guild_players`, migration 0028).
  - Unlinking Discord, "Remove my results" in an Activity, or deleting the account removes
    those rows.
  - In a DM it's always everyone.
- **Security:** every request is checked against the app's Ed25519 **Public Key**
  (`DISCORD_PUBLIC_KEY`, `DISCORD_KANA_CROSSWORD_PUBLIC_KEY`, `DISCORD_KANJI_CROSSWORD_PUBLIC_KEY`
  in `wrangler.toml`; public). With a key empty, that app's command is off.
- **Registration:** the deploy registers the command on each app that has its secret
  (`scripts/register-commands.mjs`: OAuth2 client credentials, `applications.commands.update`).
  It creates or updates the command by name, so the Activity's **Launch** command is left alone.

## Setup (Developer Portal)

1. <https://discord.com/developers/applications> → **New Application** (e.g. "Kana Wordle").
   Add the app icon, description, **Privacy Policy URL** `https://www.jareddesu.com/privacy/` and
   **Terms of Service URL** `https://www.jareddesu.com/terms/` (General Information).
2. **OAuth2:** copy the **Client ID** into `workers/sponsor-crm/wrangler.toml`
   (`DISCORD_CLIENT_ID`, public). Reset and copy the **Client Secret** into the repo's GitHub
   secrets as `DISCORD_CLIENT_SECRET` (optional: the deploy skips it when empty, and
   everything Discord stays off until both are set).
3. **OAuth2 → Redirects:** add `https://www.jareddesu.com/discord/` and
   `https://jareddesu.com/discord/`. Add `https://staging.jareddesu.com/discord/` and
   `http://localhost:8765/discord/` if you test there.
4. **Installation:** turn on **User Install** (and Guild Install if you want it on the server).
5. **Activities → URL Mappings** (each app; only the root differs):

   | Prefix | Target |
   |---|---|
   | `/` (root) | Kana Wordle: `www.jareddesu.com/activity/wordle` · Kana Crossword: `www.jareddesu.com/activity/crossword` · Kanji Crossword: `www.jareddesu.com/activity/kanji` |
   | `/site` | `www.jareddesu.com` |
   | `/api` | `sponsor-crm.jared-65b.workers.dev` |

   The crossword apps don't need OAuth2 redirects (only the website's sign-in uses them).

6. **General Information → Interactions Endpoint URL** (each app):
   `https://sponsor-crm.jared-65b.workers.dev/discord/interactions`. Put the app's **Public
   Key** (same page) in `wrangler.toml` first and deploy, since Discord checks the URL when you
   save it.
7. **Activities → Settings:** **Enable Activities**. This creates the default Entry Point
   command ("Launch"). Pick the supported platforms (web, desktop, iOS, Android).
8. Merge, let the deploy run, then open a voice channel on the server → 🚀 **Activities** →
   the app. While the app is unlisted (not in the App Directory), only you and the server
   where it's installed can launch it.

## Developer Terms of Service: what applies

From Discord's Developer Terms of Service (effective July 8, 2024), and how this follows them:

- **5(a): use API data only as your privacy policy, the law and the Terms allow; keep a
  privacy policy and link it in the Developer Portal.** The privacy page lists the Discord
  data, why it's kept, and how to delete it. Its link goes in the Portal (step 1).
- **5(b): don't share API data with third parties**, except service providers, where the law
  requires, or when the user expressly asks. Discord data is never sold or shared. It goes back
  into Discord only in the leaderboard's daily post, for players who turned the leaderboard on.
- **5(b): delete API data promptly when the user asks, and give users an easy way to ask.**
  Unlink (Settings), "Remove my results from this channel" (Activity), or email support. Each
  deletes at once.
- **9(b): delete cached or stored API data on termination.** If the app is shut down: set
  `DISCORD_CLIENT_ID` to empty, then run
  `UPDATE board_profiles SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL; DELETE FROM activity_finishes;`
  on the D1 database.
- The Terms say nothing about ads or payments inside an app. The Activity stays on the safe
  side anyway: no ads, third-party scripts, sponsor cards, checkout links or upgrade prompts.
  Crossword+ isn't sold or advertised in Discord.

## Developer Policy check (before launch)

Discord's **Developer Policy** couldn't be read while this was built (its site refused
automated access), so it is **unconfirmed**. Read it before launching the Activity:
<https://support-dev.discord.com/hc/en-us/articles/8563934450327>

Check, in particular:
- [ ] Showing Discord usernames and avatars in a public webhook post and its picture is OK
      for players who opted in.
- [ ] An Activity may honor a membership bought off Discord (Crossword+ isn't sold or shown in
      the Activity, but linked members still sync as themselves).
- [ ] Anything on data retention beyond the Terms (two days for Activity results, until
      unlink for the link).
- [ ] Requirements for apps that sign people in with Discord.

If a rule forbids part of this, turn it off before launch. Leave `DISCORD_CLIENT_ID` empty to
turn off all of Discord sign-in and the Activity, or remove the `/` URL Mapping to turn off
only the Activity.

## Limits and notes

- The Activity's frame (`discordsays.com`) keeps its own browser storage, separate from
  jareddesu.com. That's why unlinked players' dailies stay in the Discord app, and linked
  players get their account's saved dailies from the Worker.
- A daily is sent to the channel when it's finished. Games finished on the site before
  opening the Activity show only for linked players who have the leaderboard on.
- Each game starts at once; Discord sign-in runs alongside it, and each step has a time
  limit, so a stuck step never holds up the game. The status line says which one failed.
- Through Discord's proxy the Activity's requests are same-origin, so browsers send no
  `Origin` on GETs. The Worker's game routes accept those (index.js `sameSite`).
- Discord shows its own consent screen the first time someone authorizes. `prompt: 'none'`
  skips it after that.

## Testing locally

There's no Discord frame locally. `scripts/activity/discord-sdk.js` can be swapped for a
stub in a Playwright route, and a small server can stand in for Discord's proxy:
`/` → `activity/`, `/.proxy/site/*` → the repo, `/.proxy/api/*` → `wrangler dev` (pass the
browser's headers through as they are, so a missing `Origin` stays missing). Set `DISCORD_API_BASE` in
`.dev.vars` to a stub of `oauth2/token` and `users/@me`.

## Updating the SDK

```sh
npm i @discord/embedded-app-sdk@<version> esbuild
echo "export { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';" > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --minify --target=es2020 --outfile=scripts/activity/discord-sdk.js
```

Keep its MIT license next to it (`discord-sdk.LICENSE.md`), and bump `?v=` in
`scripts/activity/activity.js`.
