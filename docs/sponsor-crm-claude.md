# Claude and the Sponsor desk

Claude works with the sponsor CRM through a **custom connector**: a small MCP
server on the same Cloudflare Worker (`/mcp`). Claude reads your Gmail through
the Gmail connector you already use and writes into the CRM through this one.
No API key and no paid service is involved: it runs on your Claude
subscription and Cloudflare's free plan.

> This file is public. It contains no secrets.

## What Claude can and can't do

**Read:** tracked companies (with email domains and contacts), deals,
payments, the dashboard numbers, calendar items for a date range, video slots and uploads
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
- `save_insight`: the Monday commentary for the dashboard.
- `update_sync_cursor`: where the email sync stopped.

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
1. Call get_sync_state. In Gmail, find messages newer than the cursor (if none, the last 3 days) that are to or from the tracked domains or mention the tracked company names, plus likely sponsorship inquiries (sponsor, sponsorship, collaboration, partnership, integration, media kit, rate). Skip newsletters, receipts and notifications.
2. For each relevant message: log_email with metadata only (snippet under 300 characters), passing company_id when you know the company. Add a note only for something notable: a budget, dates, deliverables, usage rights or exclusivity, a new contact, a risk.
3. File a create_proposal only when an email clearly supports it (evidence quote, one-line reason, confidence): stage_change, amounts, dates, next_action, new_contact, add_domain (a tracked company writing from an untracked domain), new_deal (a tracked company with no deal yet), or new_company_deal (a new brand asking to sponsor). Skip anything already in pending_proposals. If a pitch is from a brand the plan avoids (AI tutors or chatbots, crypto or NFTs, gambling, "fluent in X days" apps, commission-only offers, direct Migaku competitors), still file it, but with confidence low and a reason starting "Avoid (per plan):".
4. If an email needs a reply or action, suggest_calendar_item: a task due within 2 working days.
5. If sponsors ask for topics or formats, suggest_video_idea with source sponsor_conversations.
6. update_sync_cursor to "after:YYYY/MM/DD" for the newest message processed. Reply in two lines: what you logged and filed.
```

### 2. Weekly insight: Mondays at 8:00 AM (Central)

```
Sponsor desk weekly insight. Use only the Sponsor desk connector.
1. Call get_dashboard, get_calendar for this Monday through Sunday, and list_videos.
2. save_insight with kind "weekly" and week_of this Monday: 3 to 5 sentences on what moved last week, what's at risk, and the one thing to do this week. Use only numbers from get_dashboard.
3. Suggest up to 3 tasks this week with suggest_calendar_item that close the biggest gaps (pitch target, follow-ups due, overdue actions, invoices). Don't duplicate what's already on the calendar.
4. If an upload clearly outperforms its peers, one suggest_video_idea with source performance.
Reply in one line.
```

### 3. Payment check: every morning at 7:45 AM (Central)

```
Sponsor desk payment check. Use the Sponsor desk and Gmail connectors. Never send email, never reply, and never approve anything.
1. Call list_deals and list_payments. In Gmail, search the last 3 days for money received: PayPal, Stripe, Wise, Payoneer, Venmo, Zelle, bank deposit or ACH notices, "payment received", "you've received", "remittance", "invoice paid", "transfer". Skip receipts for things I bought, refunds, payouts I sent, and anything that isn't a sponsor paying me.
2. For each payment from a sponsor: match it to a deal by company name, sender or invoice number. If list_payments already shows it paid (same deal, amount and date), skip it. Otherwise create_proposal with kind "payment", the deal_id, and values {amount (the gross the sponsor paid, in USD; convert only if the email states the USD amount), paid_on (YYYY-MM-DD it arrived), method (PayPal, Wise, bank…), fees and net only if the email shows them}. Evidence: the email date, subject, a quote under 300 characters with the amount, and the message ID. Confidence high only when the sponsor and amount are both clear.
3. If the payment covers everything owed on a deal at Won or Delivered, also create_proposal stage_change to "Paid".
4. If a payment can't be matched to any deal, don't guess: log_email it if the sender is a tracked company, and mention it in your reply.
Reply in one line: payments found, proposals filed, anything unmatched.
```

Passing a **Payment received** proposal marks a matching invoiced-but-unpaid
payment (same deal and amount) as paid, or records a new payment on the deal.

## Security notes

- The connector's sign-in page only approves apps that return to claude.ai or
  claude.com (and localhost, for testing), asks for your Sponsor desk password,
  shares the app's lockout after wrong passwords, and is protected against
  cross-site form posts.
- Claude gets 1-hour access tokens with refresh; tokens are stored hashed in a
  Cloudflare KV namespace (`sponsor-crm-oauth`), created by the deploy.
- Email content stays in Gmail. The CRM keeps only the metadata listed above.
