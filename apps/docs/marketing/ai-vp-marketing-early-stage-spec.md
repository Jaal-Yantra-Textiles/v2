Spec: Build Your Own AI VP of Marketing
A complete, implementation-ready spec to clone the "10K Dashboard" pattern — a single-operator AI marketing system for a B2B event, product launch, conference, or recurring revenue business. Hand this to a developer (or paste it into Replit Agent and tell it "build this") and you should get a working v1 in a few days.

0. The Core Philosophy
You are not building "AI features" bolted onto a dashboard. You are building two layers that compound over time:

The Autonomous Layer — dashboards, scheduled jobs, AI-generated newsletters and tactical-ideas emails. Runs 24/7 in production. No human in the loop.
The Operator Layer — the AI agent in the editor, talking to the same database and APIs, doing deep one-off analyses, drafting hand-tuned outbound emails, generating ad-hoc invite lists, and encoding every operator correction into permanent code. Editor only.
The first layer is what your team and customers see. The second layer is the moat. Every "ad-hoc" question the operator asks should leave a reusable script behind, so the system gets sharper week over week.

1. Pick the Goal Before You Pick the Tech
The dashboard only works because there is one number at the top. For 10K it's "10,000 paid attendees + $4-4.5M net revenue by May 14." Pick yours before writing a line of code:

An event? → tickets sold + sponsor revenue vs. target
A product launch? → signups + activations + paid conversions vs. target
ARR/revenue ops? → new ARR + expansion + churn vs. quarterly target
A media business? → subscribers + ad revenue + content velocity
Everything downstream — which integrations, which charts, which AI prompts — is in service of that one number. Write it on a sticky note. Don't start without it.

1.5 Day-Zero: Dump In Every Spreadsheet You Already Have
Before you write any code, before you wire any integration, collect every spreadsheet, CSV, workbook, and report you currently use to run this part of the business and drop them into a single folder (/historical-data/ or attached_assets/). The Agent should treat these as ground truth and build the initial dashboard around them.

For the 10K build, day-zero uploads included:

Final results from prior years (e.g. 2025_Annual_final.csv, AcmeCon_Revenue_2025_fixed.csv) — every stretch target and trend line is computed off these
Master revenue + planning workbook (AI_AcmeCon_Executive_Workbook_-_All_AcmeCon_Revenue_and_Planning.csv) — the source of truth for the YTD financials view; multi-year revenue, plan vs. actual, monthly cuts
In-progress current-year tracker (the 2026 Cumulative Data CSV, exported 3 times across early build) — used to seed the live dashboard before the ticketing + CRM integrations were online
Pipeline / report snapshots (Reports_snapshot.csv) — point-in-time pipeline state to backfill history
Account / engagement analytics (account_overview_analytics.csv × multiple exports) — for any partner / sponsor / customer portal work
Stakeholder lists — sponsor sheet (acmecon-2026-homepage-sponsors.csv), speaker register (AcmeCon_AI_2026_Speakers-Register.csv), CRO Summit invites (cro-summit-invite-list.csv)
Deep-dive analyses the operator already had (deep-dive-fresh-adds.csv, deep-dive-quality.csv, deep-dive-top-100-invites.csv, deep-dive-full-eligible.csv) — preserve every prior analysis as a starting point so the Agent can build on top, not from scratch
Why this matters more than it sounds:

Most of your useful history isn't in any API. Sponsor pricing five years ago, who attended your VIP dinner in 2023, the spreadsheet your CFO maintains — none of that lives in Bizzabo or Salesforce. If you don't dump it in on day zero, the Agent will only ever know what the live integrations expose.
It bootstraps the dashboard before integrations are wired. You can show real charts on day 2 instead of day 14, because the CSVs cover the gap.
It anchors AI outputs in real numbers. When the daily-ideas email says "we're tracking 12% behind 2025 at this point in the funnel," it's pulling that 2025 number from the workbook you uploaded — not hallucinating.
It seeds the script library. Every CSV you drop in becomes the input for a one-off tsx script the operator will eventually ask for ("rerun the deep-dive top-100 against this year's list").
Practical rules:

Drop the raw exports in unchanged. Don't pre-clean. Let the Agent write the parsing and write a normalization script you can re-run when you re-export.
Re-export and re-upload whenever the source workbook updates (the 2026 tracker was uploaded 3 times in the first month).
Add a section to replit.md listing what each CSV is and what it's the source of truth for.
Keep the original filename — version-stamped or timestamped — never overwrite.
If you skip this step, you'll spend the next month answering the question "where does that number come from?" with "I don't know, the API didn't have it." Don't skip it.

2. Tech Stack
Use this exact stack unless you have a strong reason not to. It is the lowest-friction path to a single-operator system that runs in production.

Layer	Choice	Why
Hosting + Editor + Agent	Replit	Long-running editor sessions for the Agent layer; one-click deploys for the autonomous layer; managed Postgres; secrets management; all in one place
Backend	Node.js + Express + TypeScript	Same language frontend ↔ backend; vast integration ecosystem
Frontend	React + TypeScript + Vite + Wouter + TanStack Query + Tailwind + shadcn/ui + Recharts	Mature, fast, no SSR complexity needed for an internal tool
Database	Postgres (Replit-managed or Neon) with Drizzle ORM	Schema in code, migrations free, cheap and reliable
Background jobs	Plain tsx scripts triggered by Replit Scheduled Deployments (or cron)	Don't bring in BullMQ/Temporal until you have 50+ jobs
LLM	OpenAI gpt-4o-mini for everything except final-draft email body (then gpt-4o)	4o-mini is cheap enough to run on every page load; reserve 4o for craft work
Email send	Resend	Cleanest API; verify your sending domain on day 1
Verified domain	One subdomain, e.g. dashboard@yourbrand.com	All transactional and AI-drafted email sends from this; never the founder's personal address
3. Required Integrations (Pick the Subset That Maps to Your Business)
For each, you'll need OAuth or API-key credentials and a small TS module that exposes typed read/write helpers and caches to Postgres.

Integration	What you read	What you write
Ticketing / Registration (Bizzabo, Eventbrite, Hopin, Luma, Stripe Checkout)	Registrations, ticket types, prices, attendee fields	Comp ticket issuance
CRM (Salesforce, HubSpot)	Pipeline, opportunities, accounts, contacts	(Optional) lead creation
Marketing automation (Marketo, HubSpot, Customer.io, Mailchimp)	List sizes, send history, open events	List membership, campaign sends
CMS / Blog (WordPress, Ghost, Sanity, Contentful)	Recent posts, post engagement	(Optional) draft posts
Social (X / LinkedIn / YouTube)	Post engagement, follower counts, video views	Tweet posting
Email send (Resend, Postmark, SendGrid)	Send + open + bounce events	All transactional + newsletter sends
Slack (incoming webhook)	—	Daily summaries, alerts, fun facts
Identity (Clerk, Auth0)	Engagement on a partner/sponsor portal if you have one	—
Rule: every integration must cache to Postgres with a short TTL (5-15 min for dashboards, 24h for historical pulls). Never let a dashboard page hit a third-party API directly.

4. Database Schema (Minimum Viable)
Drizzle in shared/schema.ts. Start with these tables — add more only when a feature requires it.

// Caches every external API response with a TTL key
api_cache(key text PK, data text, updated_at timestamp)
// Append-only daily snapshots of the headline metric for trend lines
metric_snapshots(id, taken_at, paid_count, free_count, net_revenue, sponsor_revenue, ...)
// Audit log for any write the system performs (comp ticket, email send, list add)
audit_log(id, actor, action, target, payload jsonb, created_at)
// Outbound contact log for hand-crafted emails (winbacks, exec outreach)
outreach(id, recipient_email, recipient_name, company, category,
         status, opened_at, replied_at, notes, created_at)
// Newsletter / campaign drafts saved by name
draft(id, kind, name, payload jsonb, updated_at)
// Operator overrides (manual corrections to live data)
manual_override(id, metric_key, value, reason, created_at)

Plus one table per AI-generated artifact you want to persist (daily ideas log, send log, etc.).

5. The Autonomous Layer — Build These First
5.1 The Headline Strip
Always-visible at the top: 3-4 numbers that map to the One Goal. For 10K that's Paid / 10K, Free, Total, Days to event. Put a stale-while-revalidate pattern in front of it: serve the last cached snapshot in <100ms, then swap in live data.

5.2 Tabs (Use This Exact Information Architecture)
Three top-level "uber tabs":

YTD / Overview — financials, summary, trend lines
The Active Campaign (e.g. "2026 Annual") — every operational tab for the in-flight goal
Social & Media — channel-by-channel performance, subscribers, audience
After the goal date passes, flip the primary nav to the next campaign automatically (we open a "2027 Annual" uber tab the day after the event ends).

5.3 The Cron Stack (4-6 jobs is enough)
Job	Schedule	What it does
daily-refresh	every morning 6am local	Pull all integrations, write metric_snapshots, warm caches
daily-ideas-email	weekday mornings 7am	Generate the AI tactical-ideas email and send via Resend
daily-slack-summary	weekday mornings 7:05am	Post the headline + 1 fun fact to Slack
newsletter-daily	every weekday 5am	Draft the daily content newsletter; save to draft table for operator review
newsletter-weekly	Friday 5am	Draft the weekly digest
subscriber-snapshot	nightly	Pull list sizes from Marketo/HubSpot, compute net + gross growth
Critical pattern: every cron writes its result to Postgres before sending anything externally. If Resend fails, you still have the draft.

5.4 The AI Tactical-Ideas Email (the highest-leverage feature)
Every morning, an email to the operator(s) with 3-5 tactical moves for today. Prompt skeleton:

You are an experienced VP of Marketing for {BUSINESS_DESCRIPTION}.
Today is {DATE}. The goal is {ONE_GOAL}.
Here are today's numbers vs. plan:
{INSERT REAL NUMBERS FROM POSTGRES — never hardcoded, never hallucinated}
Here is what changed since yesterday:
{DELTA FROM metric_snapshots}
Generate 3-5 specific, actionable moves for the operator to do TODAY.
Each move must be:
- Concrete (a specific channel, audience, message, or experiment)
- Achievable in <2 hours
- Tied to one of the numbers above
Style rules:
- {YOUR HOUSE STYLE — e.g. "Never say 'SaaS', always say 'B2B'"}
- {OPENING/CLOSING TONE}
- No fluff, no recap of the numbers, just the moves

Hallucination guard: server-side, replace any number-shaped token in the LLM output with the corresponding ground-truth value from your DB before sending. If a number in the output doesn't match any DB value within ±2%, flag and don't send.

5.5 Newsletter Generator (Daily + Weekly)
Operator-curated, AI-assisted — never fully autonomous send. AI drafts → operator reviews → operator clicks Send.
AI writes: subject line, preheader, intro paragraph, post ranking, section headers
Human writes: nothing (in the happy case)
Preserve the same email template for years; only swap the content payload.
One-click test send from any email address you choose.
Save every draft to draft table by name (2026-05-12-daily) so you can recover, A/B, or rerun.
5.6 Slack Daily Summary
One Slack post per morning. Headline number + delta + one "fun fact" (e.g. "53 paid tickets sold yesterday, our second-best Tuesday ever"). Use server-side guardrails to make sure the fun fact is mathematically true.

5.7 Comp Ticket / Free Pass Issuance
A simple form in the dashboard: paste an email, pick a ticket type, click Issue. Backend hits the ticketing API, writes to audit_log, sends a heads-up email from the verified domain. Always log who, what, when. Never let this be a silent action.

6. The Operator Layer — Build This Second
6.1 Use Replit Agent (or equivalent long-running coding agent)
Open one editor session per operator and never close it.
Let it run for weeks. The accumulated working memory is the point.
Every correction you give it, it should encode into either:
replit.md (style rules, team contacts, send-domain rules, voice preferences)
The codebase (a new script, a new prompt, a new schema field)
6.2 The replit.md File (or your equivalent)
A single markdown file at the project root. Sections:

## Project Overview
{One paragraph: what this is, what the goal is}
## User Preferences
- {Voice rules: "Never say X, always say Y"}
- {Tone: "Direct, no fluff"}
- {Send-from rule: "All emails from dashboard@yourbrand.com"}
- {Verified-domain rule: list every domain you've verified with Resend}
## Team Contacts
- Person — role — email
## System Architecture
{Frontend / backend stack, integration list, important caches and TTLs,
list of cron jobs, list of one-off scripts in /scripts}
## External Dependencies
{One bullet per third-party service with what it's used for}

The Agent reads this on every session start. It's the institutional memory.

6.3 The /scripts Directory
Every ad-hoc analysis the operator asks for becomes a tsx script:

scripts/top-200-vip-list.ts — operator asks "give me top 200 to invite"; agent writes the script and CSV
scripts/pricing-analysis.ts — "what did we launch with?"; agent writes the timeline pull
scripts/find-deal.ts — "find Kris@Work's SF deal"; agent writes the SOQL
scripts/historical-vips.ts — "pull every paid VIP from past 5 years"
Run with npx tsx scripts/X.ts > /tmp/x.log 2>&1. Store outputs as CSV in repo root or Object Storage. Never delete a script — it's an asset that compounds.

6.4 The Hand-Tuned Outbound Email Workflow
Two campaign categories worth automating in concert with the operator:

Winbacks — emails to churned customers / sponsors / lapsed users with a specific personalized angle
Exec Outreach — "here's who to meet at our event" personalized intros
Build a WinbacksView component:

Table of outreach rows with columns: Sent, Recipient, Company, Category, Status, Opened, Replied, Notes
"Sync from Resend" button — pulls send + open + bounce events back into the table
"Log Outreach" button — manual entry for an email the operator just sent
Operator drafts emails in the Agent chat ("write me a winback to {company} CMO referencing their latest funding round") → reviews → sends → clicks Log
Important honesty: Resend's "bounced" status is unreliable (it includes suppression-list hits, not just real SMTP fails). Surface a yellow warning on top of the table that says exactly that, so operators don't trust the field as final.

7. Style, Voice, and Hallucination Rules
7.1 Voice Rules Live in replit.md
Examples that have actually mattered:

"Never say 'SaaS', always say 'B2B'" (preserved across all AI prompts)
"Outbound default From: Brand 10K <dashboard@yourbrand.com>" — never the founder personally unless explicitly asked
"NET revenue, never gross"
"{verified-domain}.com is the only Resend-verified sender. Don't try to send from any other domain."
7.2 Number Hallucination Guard
For any AI output that includes numbers (newsletters, ideas emails, fun facts):

Build the prompt with the real numbers explicitly listed
Pass a token substitution map — placeholders the LLM should use ({TODAY_PAID}, {DELTA_DOD})
After generation, regex-validate that every numeric substring in the output matches a value in your ground-truth set within tolerance
If validation fails, regenerate once with stricter instructions; if it fails again, flag for human review
7.3 Date / Time Awareness
Always pass today's date in the local timezone (PT for AcmeCon) into every prompt. AI models will hallucinate dates if you don't.

8. Security and Production Hygiene
Secrets — never in code. Use Replit Secrets or your platform's equivalent. The Agent should never print or commit secret values.
Audit logging — every write the system performs (email send, comp ticket, list add, lead create) writes a row to audit_log with actor + payload.
Rate limits — every external API call wrapped in a retry-with-backoff helper.
Domain verification — verify your Resend (or equivalent) domain on day 1. Don't try to send from un-verified domains.
Read-only credentials by default — if an integration supports a read-only token, use it. Only use write-scoped credentials for the specific cron job that needs them.
Sandboxed AI writes — the public-facing chatbot (if you build one) can READ the same DB but should never WRITE.
9. The Public-Facing Chatbot (Optional, Build Last)
If you want a "talk to our marketing AI" experience for visitors:

A single-page chat at /marketing-ideas (or wherever)
Backed by gpt-4o-mini with a system prompt that knows your business
Pulls a read-only snapshot of safe metrics from Postgres (don't expose pipeline)
Rate-limited per IP (10 messages/hour is plenty)
Heavily prompt-engineered to refuse off-topic requests
NOT a substitute for the operator-side Agent. This is for prospects to play with. The deep work still happens in the editor.
10. Build Order (4-week MVP)
Week 1 — Foundation
Replit project, Postgres, Drizzle schema, secrets configured
Two integrations live (your ticketing + your CRM) with caching to Postgres
Headline strip + 1 dashboard tab showing live numbers
metric_snapshots cron writing nightly
Week 2 — Autonomous Layer
Daily AI tactical-ideas email (with hallucination guard)
Slack daily summary
Newsletter draft generator (daily) — operator review, manual send
Comp ticket issuance form
Week 3 — Operator Layer
/scripts directory pattern established
replit.md populated with voice rules + team
Winbacks/Outreach table + Resend sync
2-3 ad-hoc analysis scripts written by the Agent in response to real operator questions
Week 4 — Polish + Compounding Features
Stale-while-revalidate caching everywhere
Dark mode + your brand color
Drill-downs on every chart
Subscriber growth tracking (gross + net)
Whatever specific superpower YOUR business needs that nobody else's does
11. The Three Things That Will Trip You Up
Skipping the cache layer. A dashboard that hits live APIs on every page load will be slow, expensive, and rate-limited within a week. Cache to Postgres. Always.
Letting AI invent numbers. Build the hallucination guard before you ship the first AI email. One wrong number that goes to your team or your list erodes trust faster than you can rebuild it.
Treating the Agent as a chatbot. It's a teammate. Encode every correction. Save every script. Keep the editor session open for weeks. Update replit.md constantly. The compounding only happens if you treat it that way.
12. The One-Sentence Sales Pitch (for buy-in)
"Build a system where your dashboard, your daily marketing playbook, your newsletters, and your sponsor + customer outreach all run from one place — autonomously where they can be, with one operator + an AI agent everywhere they can't. The dashboard ships to production. The agent stays in the editor. The institutional memory lives in code. After three months, the system knows more about how you run marketing than any new hire would after a year."

That's the spec. Hand it to a developer, paste it into Replit Agent, or use it as the brief for your own internal team. The system is opinionated on purpose — the opinions are what make it work with one operator instead of five.