# Marketing (AI VP of Marketing) — Setup & Newsletter Guide

> Operator guide for the in-house marketing-ops system shipped under #659.
> Covers what exists, how to turn it on, and how to run a newsletter end-to-end
> in the **current setup**. All of this is built on existing platform primitives
> (scheduled jobs, the #457 Data Plumbing registry, the analytics rollup, the
> notification module + email queue, AI SDK/OpenRouter).

---

## 1. What it is (the surfaces)

The marketing system is a thin **advisory + action layer** over the existing
data. It is **independent** of the `ad_planning` module (which stays the
analytics/scoring engine); marketing only *reads* ad_planning via `query.graph`.

| Surface | Where | What it does |
|---|---|---|
| **Marketing admin page** | Admin → **Marketing** (`/app/marketing`) | GMV headline strip (the "One Goal") + secondary KPI cards, stale badge |
| **Winbacks** | Admin → Marketing → **Winbacks** | Table of winback outreach rows (status, bounce-unreliable honesty badge) |
| **Data Plumbing jobs** | Admin → Settings → **Data Plumbing** | Run every marketing action on demand (dry-run → apply), audited in `ops_audit` |
| **Ideas-email visual flow** | Admin → Visual Flows | The scheduled daily tactical-ideas email (operator-editable cadence) |
| **Newsletter** | Admin → Websites → a site → Pages → **New page → type "Newsletter"** | Create/edit/send a newsletter, optionally pre-filled by AI |

Data model lives in the `marketing` module (`apps/backend/src/modules/marketing`):
`marketing_metric_snapshot`, `marketing_ideas_log`, `marketing_draft`,
`marketing_outreach`, `marketing_manual_override`.

---

## 2. How the headline / metrics work

- A scheduled job **`marketing-daily-refresh`** (`apps/backend/src/jobs/marketing-daily-refresh.ts`,
  cron `0 1 * * *` ≈ 6:30 AM IST) computes the last complete IST business day's
  metrics from existing sources — paid-order GMV (via Query), storefront sessions
  (the #559 `analytics_daily_stats` rollup), derived conversion — and writes
  append-only `marketing_metric_snapshot` rows, then warms a Redis hot path.
- The **One Goal** headline metric is **`platform_net_gmv`** (locked decision).
  The admin page + the AI email read this as the hero number.
- The admin page reads `GET /admin/marketing/headline` (stale-while-revalidate);
  if the latest business day is > 3 days old it shows a **"Stale"** badge.

> Nothing to configure to see metrics — once the daily-refresh job has run (or you
> seed snapshot rows), the Marketing page populates. With no data it shows a clean
> empty state.

---

## 3. The Data Plumbing jobs (the control surface)

Open **Settings → Data Plumbing**, pick a job, **dry-run** (preview, no writes
that send anything), then **apply**. Every run is recorded in `ops_audit`.

| Job id | What it does |
|---|---|
| `run-marketing-ideas-email` | Generate the daily AI tactical-ideas email (+ hallucination guard) → dry-run persists a reviewable `marketing_ideas_log` draft and **emails no one**; **apply emails it** (the apply click overrides the send gate). Optional `log_id` (send a specific reviewed draft) / `recipients`. |
| `install-marketing-ideas-email-flow` | **Load** the daily ideas-email **visual flow** into the system (dry-run previews; apply creates it as a DRAFT). No shell/seed needed. |
| `generate-winback-targets` | Read `ad_planning.CustomerScore` churn-risk → select winback targets → dry-run previews, apply creates `marketing_outreach` rows (campaign="winback"). |
| `send-marketing-daily-summary` | Compose a daily marketing summary (GMV headline + KPIs) and send it over **WhatsApp** (the chosen operator-alert channel). |

---

## 4. Configuration / env

| Env var | Purpose | Default |
|---|---|---|
| `MARKETING_IDEAS_EMAIL_ENABLED` | Global send gate for the **scheduled** ideas-email flow (manual "apply" from the console ignores this). | OFF |
| `MARKETING_ONE_GOAL` | The One-Goal sentence fed to the AI email. | "Grow platform GMV…" |
| `MARKETING_IDEAS_RECIPIENTS` | CSV recipient override for the ideas-email (else platform admins). | platform admins |
| `MARKETING_IDEAS_MODEL` | OpenRouter model for the AI email. | `anthropic/claude-3.5-sonnet` |
| `OPENROUTER_API_KEY` | Required for any AI generation (ideas-email, newsletter). | — |

**Email sending** is NOT a new system — it reuses the existing per-day queue
`apps/backend/src/jobs/process-email-queue.ts` (runs daily 6 AM), which
distributes across the connected providers (**Resend** `email`, **Mailjet**
`email_bulk`, **Maileroo** `email_partner`) with retry + next-day overflow. The
marketing/newsletter features just enqueue into it — no verified-subdomain setup
required.

---

## 5. Turn on the daily ideas-email (automatic)

1. **Settings → Data Plumbing → `install-marketing-ideas-email-flow`** → dry-run
   (preview), then **apply** → it creates the visual flow as a DRAFT
   (`schedule 30 1 * * *` ≈ 7 AM IST → generate → guard → send → log).
2. Open the flow on the canvas. **Send is OFF by default** (safety). To make it
   actually email, either:
   - set `send_enabled: true` on the `run_ideas` node (canvas, **no redeploy**), or
   - set env `MARKETING_IDEAS_EMAIL_ENABLED=true` (global; needs a redeploy in prod).
3. Flip the flow **draft → active**.

Until you opt in, an active flow only **generates + logs** a reviewable draft in
`marketing_ideas_log` each morning — it never emails.

> Prefer manual? Skip the flow and just run `run-marketing-ideas-email` from the
> console whenever — **apply** sends regardless of the env gate (the click is the
> consent).

---

## 6. Run a newsletter (end-to-end)

Newsletters reuse the **existing blog editor + subscriber-send** — a newsletter is
just a `page` with `page_type = "Newsletter"`.

**AI authoring lives in the editor** (not Data Plumbing) — generation is resolved
from the admin-configured social-platform AI provider tagged
`metadata.role = ai_newsletter_drafter` (Settings → External Platforms), with an
`OPENROUTER_API_KEY` env fallback. `POST /admin/marketing/newsletter/generate`
returns `{ title, content }`; nothing is persisted (the page is the draft).

1. **Create the page:** Admin → Websites → your site → **New page** (or the Blog
   modal — both now offer the type).
   - Set **Page Type → Newsletter**.
   - Click **"Write with AI"** → generates a draft and fills the **title + summary**.
     Edit freely.
   - Fill the **slug**, then **Create Pages**.
2. **Write the body with AI (inline):** in the page's **MainContent** block editor,
   use the **"✨ AI" toolbar button** to generate copy and insert it at the cursor
   (TipTap extension). Refine inline.
3. **Send it:** open the newsletter page → **Send to Subscribers** (the same flow
   blog posts use; the Blog-only guards were widened to allow `Newsletter`). It
   enqueues into `process-email-queue` and stamps `sent_to_subscribers` /
   `subscriber_count` on the page.

> Newsletters are **excluded** from the public storefront pages route (they're
> email content, mirroring how `Blog` is handled).

---

## 7. Winbacks

1. Settings → Data Plumbing → `generate-winback-targets` → dry-run to preview the
   churn-risk targets, then apply → creates `marketing_outreach` rows
   (campaign="winback").
2. View them in Admin → Marketing → **Winbacks**. A **"Bounce unreliable"** badge
   flags rows where provider bounce data is untrustworthy — we never auto-suppress.

---

## 8. Where things live (quick map)

```
apps/backend/src/modules/marketing/            # 5 models + service + migration
apps/backend/src/workflows/marketing/          # generate/send ideas-email, newsletter, run-daily-ideas-email, libs
apps/backend/src/jobs/marketing-daily-refresh.ts
apps/backend/src/api/admin/marketing/          # snapshots / headline / ideas-log / outreach / newsletter-prefill routes + read-lib
apps/backend/src/api/admin/ops/maintenance-jobs/registry.ts   # all marketing Data Plumbing jobs
apps/backend/src/modules/visual_flows/operations/marketing-daily-ideas-email.ts
apps/backend/src/admin/routes/marketing/        # /admin/marketing page + winbacks
apps/backend/src/admin/components/creates/create-page.tsx     # Newsletter prefill button
```

Spec/adaptation source: `apps/docs/marketing/AI_VP_MARKETING_JYT_ADAPTATION.md`
and the `0X_*_SPEC.md` per-slice docs in this folder.

---

## 9. Local testing

- Apply migrations: `cd apps/backend && npx medusa db:migrate`.
- Integration tests (shared DB): `pnpm test:integration:http:shared "integration-tests/http/(marketing-|outreach|ops-maintenance-jobs)"`
  (a few may transiently fail on shared-DB GIN-index deadlocks — re-run the
  affected file alone to confirm).
- UI: `medusa develop` hot-reloads admin routes; create a throwaway admin with
  `npx medusa user -e you@local -p 'pw'` and visit `/app/marketing`.
