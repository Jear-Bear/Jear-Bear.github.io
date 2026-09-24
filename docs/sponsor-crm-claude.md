# Claude and the Sponsor desk

Claude works with the sponsor CRM through a **custom connector**: a small MCP
server on the same Cloudflare Worker (`/mcp`). Claude reads your Gmail through
the Gmail connector you already use and writes into the CRM through this one.
No API key and no paid service is involved: it runs on your Claude
subscription and Cloudflare's free plan.

> This file is public. It contains no secrets.

## What Claude can and can't do

**Read:** tracked companies (with email domains and contacts), deals, the
dashboard numbers, calendar items for a date range, video slots and uploads
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

Create these in Claude as scheduled tasks (in Cowork, type `/schedule`, or use
the Scheduled section), with the **Sponsor desk** and **Gmail** connectors on.
They're written to be short so each run uses little of your plan's usage.

### 1. Email sync: weekdays at 7:30 AM (Central)

```
Sponsor desk email sync. Use the Sponsor desk and Gmail connectors. Never send email and never approve anything.
1. Call get_sync_state. In Gmail, find messages newer than the cursor (if none, the last 3 days) that are to or from the tracked domains or mention the tracked company names, plus likely sponsorship inquiries (sponsor, sponsorship, collaboration, partnership, integration, media kit, rate). Skip newsletters, receipts and notifications.
2. For each relevant message: log_email with metadata only (snippet under 300 characters), passing company_id when you know the company. Add a note only for something notable: a budget, dates, deliverables, usage rights or exclusivity, a new contact, a risk.
3. File a create_proposal only when an email clearly supports it (evidence quote, one-line reason, confidence): stage_change, amounts, dates, next_action, new_contact, add_domain (a tracked company writing from an untracked domain), or new_company_deal (a new brand asking to sponsor). Skip anything already in pending_proposals.
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

## Security notes

- The connector's sign-in page only approves apps that return to claude.ai or
  claude.com (and localhost, for testing), asks for your Sponsor desk password,
  shares the app's lockout after wrong passwords, and is protected against
  cross-site form posts.
- Claude gets 1-hour access tokens with refresh; tokens are stored hashed in a
  Cloudflare KV namespace (`sponsor-crm-oauth`), created by the deploy.
- Email content stays in Gmail. The CRM keeps only the metadata listed above.
