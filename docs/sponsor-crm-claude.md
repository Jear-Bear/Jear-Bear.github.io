# Claude and the Sponsor desk

Claude works with the sponsor CRM through a **custom connector**: a small MCP
server on the same Cloudflare Worker (`/mcp`). Claude reads your Gmail through
the Gmail connector you already use and writes into the CRM through this one.
No API key and no paid service is involved: it runs on your Claude
subscription and Cloudflare's free plan.

> This file is public. It contains no secrets.

## What Claude can and can't do

**Read:** prospecting context (avoid list, category cooldowns, brands to
skip, open slots), drafts you asked for, tracked companies (with email domains and contacts), deals,
payments, the dashboard numbers, the Insights numbers (streak, rate-raise
rules, milestone projections, full-time progress, computed in code), calendar items for a date range, video slots and uploads
with views, the rate card, and the email sync state.

**Write, and only into the review queue:**

- `log_email`: an email's metadata on a company's timeline (date, direction,
  from/to/cc, subject, a snippet under 300 characters, the Gmail link) plus an
  optional short note from Claude. Logging the same message twice does nothing.
- `create_proposal`: a proposed stage change, amount, date, next action, new
  contact, new email domain, or new company + inbound deal, always with the
  email evidence, a one-line reason and a confidence.
- `suggest_calendar_item`: a task or event shown as **Claude (suggested)**.
- `suggest_video_idea`: an idea from what's performing and what sponsors ask for.
- `save_insight`: the Monday commentary, shown at the top of the dashboard
  (earlier ones stay under "Earlier insights").
- `update_sync_cursor`: where the email sync stopped.
- `complete_draft_request`: marks a draft you asked for as done, after Claude
  saves it in Gmail with the Gmail connector (drafts only, never sent).

There is **no tool that deletes anything** or directly changes a stage, an
amount or a date. Every proposal waits in **Review** until you **Pass** it (you
can edit any value first) or **Dismiss** it. Everything Claude writes is
validated on the server and shown as plain text in the app.

## Add the connector (once)

1. In Claude, open **Customize → Connectors → Add custom connector** (on some
   versions: **Settings → Connectors**).
2. Name: `Sponsor desk`. URL: `https://sponsor-crm.jared-65b.workers.dev/mcp`
   (also shown in the app under **Settings → Claude connector**).
3. Tap **Add**, then **Connect**. A Sponsor desk page opens: check it says it
   returns to claude.ai, enter your Sponsor desk password, and tap **Connect**.
4. In the connector's settings, you can set the write tools to **Always allow**
   so the scheduled tasks below can run without you. Reads are harmless; the
   writes only fill the review queue.

To disconnect, use **Settings → Claude connector → Revoke** in the app, or
remove the connector in Claude. Sessions stay connected while they're used and
expire after 30 days idle.

## Scheduled tasks

Create each one in the Claude app (Pro or above; desktop, web or mobile) by
starting a **new chat** with the **Sponsor desk** and **Gmail** connectors on
and pasting the prompt below, preceded by a schedule line such as
`Every weekday at 7:30 AM Central time, run this task:`. Claude proposes the
schedule; check the time and tap **Schedule**. If it asks for an approval mode,
let the tools run without asking (their writes only fill the review queue).
On desktop you can instead use **Cowork → Scheduled → New task → Set up
manually**. (`/schedule` is not a command in regular chats or Claude Code.)
The prompts are short so each run uses little of your plan's usage.

### 1. Email sync: weekdays at 7:30 AM (Central)

```
Sponsor desk email sync. Use the Sponsor desk and Gmail connectors. Never send email and never approve anything.
1. Call get_sync_state. In Gmail, find messages newer than the cursor (if none, the last 3 days) that are to or from the tracked domains or mention the tracked company names, plus likely sponsorship inquiries (sponsor, sponsorship, collaboration, partnership, integration, media kit, rate). Skip newsletters, receipts and notifications, and Web3Forms "Sponsorship inquiry" emails (the sponsor page files those in Review itself).
2. For each relevant message: log_email with metadata only (snippet under 300 characters), passing company_id when you know the company. Add a note only for something notable: a budget, dates, deliverables, usage rights or exclusivity, a new contact, a risk.
3. File a create_proposal only when an email clearly supports it (evidence quote, one-line reason, confidence): stage_change, amounts, dates, next_action, new_contact, add_domain (a tracked company writing from an untracked domain), new_deal (a tracked company with no deal yet), or new_company_deal (a new brand asking to sponsor). Skip anything already in pending_proposals. If a pitch is from a brand the plan avoids (AI tutors or chatbots, crypto or NFTs, gambling, "fluent in X days" apps, commission-only offers, direct Migaku competitors), still file it, but with confidence low and a reason starting "Avoid (per plan):".
4. If an email needs a reply or action, suggest_calendar_item: a task due within 2 working days.
5. If sponsors ask for topics or formats, suggest_video_idea with source sponsor_conversations.
6. update_sync_cursor to "after:YYYY/MM/DD" for the newest message processed.
7. Call get_draft_requests. For each: write the email in Gmail with create_draft to the given address (never send). Pitch: start from the template text, replace every [bracketed] part with one specific, true line about the brand (check their site), keep the numbers as given, keep it under 150 words. Follow-up: a short, friendly nudge on the original thread's subject. Recap: the numbers given (views at 30 days vs estimate, clicks), one line on what worked, and a renewal offer at the given price. Then complete_draft_request with the draft's subject, or cancelled with the reason.
Reply in two lines: what you logged and filed, and which drafts you saved.
```

### 2. Weekly insight: Mondays at 8:00 AM (Central)

```
Sponsor desk weekly insight. Use only the Sponsor desk connector. Never approve anything.
1. Call get_dashboard, get_insights, get_calendar for this Monday through Sunday, list_videos and get_prospecting_context.
2. save_insight with kind "weekly" and week_of this Monday: 3 to 5 sentences, plain and specific. Cover what moved last week (pitches vs the weekly target, replies, deals won, money collected), what's at risk (follow-ups due, overdue actions, unpaid invoices, a slot in the next 6 weeks with no sponsor, a broken pitch streak), and the one thing to do this week. Mention a rate-raise rule only if it triggered, and the full-time tracker only if something changed (a new month at target, the projection moved). Use only numbers from get_dashboard and get_insights; don't recompute or estimate.
3. Suggest up to 3 tasks this week with suggest_calendar_item that close the biggest gaps: pitches short of target (put a pitch block in the Wednesday sales block), follow-ups due, overdue next actions, invoices to send or chase, recaps due. Don't duplicate anything already on the calendar.
4. If an upload clearly outperforms its peers in list_videos, one suggest_video_idea with source performance. If a category has a much better reply rate in pitch_performance, say so in the insight.
Reply in one line.
```

### 3. Payment check: every morning at 7:45 AM (Central)

```
Sponsor desk payment check. Use the Sponsor desk and Gmail connectors. Never send email, never reply, and never approve anything.
1. Call list_deals, list_payments and get_sync_state. In Gmail, search the last 3 days for money received: PayPal, Stripe, Wise, Payoneer, Venmo, Zelle, bank deposit or ACH notices, affiliate payouts (Migaku, Amazon Associates, others), "payment received", "you've received", "remittance", "invoice paid", "payout", "transfer". Skip receipts for things I bought, refunds, payouts I sent, personal transfers, Google AdSense and YouTube payment emails (YouTube revenue comes from the monthly YouTube revenue task), and anything already in pending_proposals (match by message ID).
2. Sponsor payments: match to a deal by company name, sender, or invoice number (list_payments shows invoice numbers like INV-0001 and unpaid invoices). If list_payments already shows it paid (same deal, amount and date), skip it. Otherwise create_proposal kind "payment" with the deal_id and values {amount (the gross the sponsor paid, in USD; use a USD figure only if the email states one), paid_on (YYYY-MM-DD it arrived), method, fees and net only if shown}. If the payment covers everything owed on a deal at Won or Delivered, also file stage_change to "Paid".
3. A sponsor that paid but has no deal: file new_deal (tracked company, with company_id) or new_company_deal, with stage "Paid", quoted, and paid_amount, paid_on and paid_method, so passing it records the payment.
4. Other creator income that isn't from YouTube (affiliate payouts, anything else): create_proposal kind "income" with values {month (YYYY-MM the money arrived), source ("affiliates" or "other"), amount (USD), program (e.g. "Migaku", "Amazon")}. Never file affiliate payouts as deals.
5. Every proposal: evidence with the email date, subject, a quote under 300 characters showing the amount, and the Gmail message ID. Confidence high only when the payer and amount are both clear.
Reply in one line: sponsor payments, other income, and anything you couldn't match.
```

For a sponsor that paid but has no deal in the CRM yet, Claude files a new
deal (or new company + deal) with `paid_amount`, `paid_on` and `paid_method`:
passing it creates the deal at Paid and records the payment. Deals marked Paid
without a payment are listed at the top of **Payments** with a one-click
**Record payment**; they don't count as income until then.

Passing a **Payment received** proposal marks a matching invoiced-but-unpaid
payment (same deal and amount) as paid, or records a new payment on the deal.

### 4. Prospecting: Mondays at 8:30 AM (Central)

```
Sponsor desk prospecting. Use the Sponsor desk connector and web search. Never contact anyone and never approve anything.
1. Call get_prospecting_context and get_sync_state.
2. Find 8 brands that could sponsor a Japanese-learning guide video: products Japanese learners actually use (apps, tutoring, dictionaries, e-books and manga, keyboards and desk gear, Japan travel, study abroad, snack boxes, VPNs, creator tools). Skip anything on the avoid list, any category in category_cooldowns, anything in skip_for_now or tracked_companies, brands already waiting in pending_proposals (new_company), and competitors of active exclusivity. Prefer brands that already sponsor language or Japan creators, or run a creator or affiliate program, and categories with better reply rates in pitch_performance.
3. For each, create_proposal kind new_company_deal with company {name, domains, category (one of categories), website, fit (High/Medium/Low), contact_method ("email" or "form"), form_url if they use a form} and deal {source "Cold", stage "Researching", notes: which open slot fits and why in one sentence, plus the partnerships contact route}. Evidence: the page you found it on (subject: the page title, quote: the line that shows they sponsor creators or fit). Confidence medium unless the fit is obvious.
Reply in one line: how many you filed and the categories.
```

Pass the ones you like in **Review**; they land in the Pipeline at
Researching. On a deal, **Write pitch…** fills your template with live
numbers: open it as a Gmail draft, or **Ask Claude to draft it** and the
morning run saves a personalized draft. **Mark as pitched** records which
template you used for **Insights → Pitch performance**.

### 5. YouTube revenue: monthly, on the 5th at 8:00 AM (Central)

Uses the **vidIQ** connector (connected to your channel), which can read
YouTube Analytics revenue. The CRM's own YouTube connection can't, by design.

```
Sponsor desk YouTube revenue. Use the vidIQ and Sponsor desk connectors. Never approve anything.
1. Call get_sync_state. With vidiq_channel_analytics for channel UCSIxTP9PCM2kcTszONRxZ1w, dimensions ["month"], metrics ["estimatedRevenue", "estimatedAdRevenue", "estimatedRedPartnerRevenue"], get last month (first to last day).
2. File two create_proposal kind "income" for that month (skip a zero amount):
   - source "adsense", program "YouTube ads + Premium", amount = estimatedAdRevenue + estimatedRedPartnerRevenue (rounded to cents).
   - source "memberships", program "YouTube memberships, Supers and other", amount = estimatedRevenue − estimatedAdRevenue − estimatedRedPartnerRevenue.
   Evidence: subject "YouTube Analytics · <month>", quote with the three numbers, message_id "youtube-analytics:<YYYY-MM>:<source>". Confidence high. Reason: "Estimated earnings from YouTube Analytics (by month earned)."
Reply in one line with both amounts.
```

The numbers are YouTube's estimated earnings by the month they were earned
(what Studio shows), not the AdSense payout date. Pass them with
**Review → Select all income → Pass selected**.

## Security notes

- The connector's sign-in page only approves apps that return to claude.ai or
  claude.com (and localhost, for testing), asks for your Sponsor desk password,
  shares the app's lockout after wrong passwords, and is protected against
  cross-site form posts.
- Claude gets 1-hour access tokens with refresh; tokens are stored hashed in a
  Cloudflare KV namespace (`sponsor-crm-oauth`), created by the deploy.
- Email content stays in Gmail. The CRM keeps only the metadata listed above.
