# Staging site

**https://staging.jareddesu.com** shows the newest pull request before it goes live.
Every push to a pull request into `main` builds the site the same way GitHub Pages
does (Jekyll) and puts it there (`.github/workflows/staging.yml`). Merging the pull
request puts it on the live site as usual; staging then shows the next pull request.

- It's the whole site, with a small orange **STAGING** tag in the corner, hidden
  from search engines.
- It talks to the real sponsor Worker: signing in, Crossword+ and payments all work.
  While Stripe is in **test mode**, pay with `4242 4242 4242 4242`. Once Stripe is
  live, payments on staging are real too (refund yourself in Stripe).
- Accounts, progress sync and the free deck puzzle are shared with the live site
  (same Worker, same database).
- Each run is listed under GitHub → Actions → **Staging**, with the link.

## Setup (once)

1. **Cloudflare token.** Cloudflare → My Profile → API Tokens → the token saved as
   the GitHub secret `CLOUDFLARE_API_TOKEN` → Edit → add the permission
   **Account · Cloudflare Pages · Edit** → Save. (Same token, no new secret.)
2. **Run it once:** GitHub → Actions → **Staging** → Run workflow. This creates the
   Cloudflare Pages project `jareddesu-staging`; the site is then at
   https://jareddesu-staging.pages.dev.
3. **The address.** Cloudflare → Workers & Pages → `jareddesu-staging` → Custom
   domains → Set up a domain → `staging.jareddesu.com`. Cloudflare shows a CNAME
   record; add it where jareddesu.com's DNS is (Namecheap → Domain List →
   jareddesu.com → Advanced DNS → Add new record → CNAME, host `staging`, value
   `jareddesu-staging.pages.dev`). It's ready in a few minutes.
4. **Google sign-in on staging:** Google Cloud console → APIs & Services →
   Credentials → the OAuth client → Authorized JavaScript origins → add
   `https://staging.jareddesu.com`. (Email-link sign-in works without this.)

Only `https://staging.jareddesu.com` can sign in and pay; the `pages.dev` address
shows everything else.
