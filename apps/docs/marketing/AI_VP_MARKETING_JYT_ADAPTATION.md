# AI VP of Marketing — JYT Adaptation Report

**Source spec:** [`ai-vp-marketing-early-stage-spec.md`](./ai-vp-marketing-early-stage-spec.md) — "Build Your Own AI VP of Marketing" (the 10K Dashboard pattern: a single-operator AI marketing system).
**Status:** Analysis / implementation brief. Generated 2026-06-22.
**Tracking issue:** see the `[marketing]` roadmap issue created alongside this doc.

---

## 0. TL;DR — the one thing to internalize

The spec describes building this system **from scratch on Replit + Express + Drizzle**. JYT does **not** need to do that. JYT is a Medusa 2.x platform that *already ships* almost every primitive the spec calls for:

| Spec primitive | JYT already has |
|---|---|
| Managed Postgres + schema-in-code | Postgres + MikroORM `model.define()` modules |
| Background jobs (Replit Scheduled Deployments) | Medusa **scheduled jobs** (`src/jobs/`) |
| `/scripts` operator-script library | `scripts/` + the **ops maintenance-jobs registry (#457)** — a guarded, dry-run/apply, audited script-library-*as-a-product* |
| `audit_log` table | the **`ops_audit` module (#457, PR #480)** already persists every guarded run |
| Dashboards | the **analytics module + admin UI (#559)**, OpenPanel-parity, in-house Postgres+Redis batching |
| LLM wiring | **AI SDK + Mastra + OpenRouter** already in the stack; AI fields already on the social-platform module (#628) |
| The "operator AI agent in the editor" | **the autonomous PR daemon** (`scripts/agent-daemon/`) + Claude Code in this repo — already encoding every correction into code + memory |
| `replit.md` institutional memory | **`.claude/CLAUDE.md`** + the file-based memory under `~/.claude/.../memory/` |
| Integrations to *write* to (social, messaging) | **social-platform module** + **WhatsApp automation** + Shiprocket/Delhivery |

**So the build is ~70% assembly of existing parts, ~30% net-new (the marketing-specific autonomous layer: tactical-ideas email, newsletter generator, outreach table, hallucination guard).** The right framing is *"stand up an AI-VP-of-Marketing surface on top of the Medusa platform we already run,"* not *"clone a Replit app."*

---

## 1. Pick the One Goal (do this before any code)

The spec is emphatic: one number at the top, everything in service of it. JYT is a textile-production commerce platform becoming a multi-tenant SaaS (partners run storefronts through us). Candidate headline goals — **pick exactly one to start**:

1. **Platform GMV / net revenue** — total paid order value across all partner storefronts vs. a quarterly target. (Closest to the spec's revenue framing.)
2. **Partner activation** — # of partners with a live storefront + first paid order vs. target. (Best if the current bottleneck is partner onboarding → first sale.)
3. **Storefront conversion** — sessions → paid orders across partner storefronts (ties directly into the #559 analytics work + #349 SEO).

**Recommendation:** start with **#2 (partner activation)** *or* **#1 (GMV)** depending on whether the near-term constraint is *acquiring/activating partners* or *growing revenue from existing ones*. Write it on the sticky note. Everything below assumes one is chosen.

> Open decision for the operator — captured in the tracking issue.

---

## 2. Day-Zero: dump in every spreadsheet (this step is NOT optional)

The spec's most underrated instruction. JYT's twist: much of the "history" already lives in Postgres (orders, partners, designs, production runs), but the *off-platform* context does not — sponsor/partner pricing history, manual revenue workbooks, prior outreach lists, the CFO's spreadsheet.

**Action:** create `apps/docs/marketing/historical-data/` (or an S3 prefix) and drop in, unchanged, every CSV/workbook used to run marketing + partner growth today. Add a manifest section to this doc (or `CLAUDE.md`) naming what each file is the source of truth for. Re-export + re-upload whenever a source updates; never overwrite (timestamp the filename). This bootstraps the dashboard before integrations are wired and anchors every AI output in real numbers.

---

## 3. Stack mapping — spec → JYT (use what we have)

| Spec layer | Spec choice | **JYT equivalent (use this instead)** |
|---|---|---|
| Hosting + deploy | Replit | **AWS Fargate** (`deploy/aws/`), auto-deploy on merge to main |
| Backend | Node + Express + TS | **Medusa 2.x API routes** (`src/api/`), workflows, subscribers |
| Frontend | React + Vite + Wouter + shadcn | **Medusa admin extensions** (admin UI) + partner-ui (Vite/React) + Medusa UI design tokens |
| DB | Postgres + Drizzle | **Postgres + MikroORM** via `model.define()` modules |
| Background jobs | tsx + Replit Scheduled Deployments | **Medusa scheduled jobs** (`src/jobs/*.ts`, cron string export) |
| LLM | OpenAI 4o-mini / 4o | **AI SDK + OpenRouter** (already wired); pick a cheap model for per-load, a strong one (Claude/4o-class) for final-draft copy |
| Email send | Resend | **the existing email/notification path** (email workflows under `src/workflows/email/`); verify a sending subdomain on day 1 |
| Slack | incoming webhook | **Slack webhook** *or* reuse the **WhatsApp automation** for operator alerts (JYT already runs WhatsApp) |
| Operator AI agent | Replit Agent | **Claude Code + the PR daemon** (`scripts/agent-daemon/`) |
| Institutional memory | `replit.md` | **`.claude/CLAUDE.md`** + file-based memory |

**Critical JYT-specific gotchas to respect when building any of this** (from platform memory):
- **No load-bearing data in `metadata`** — Medusa replaces the whole metadata blob on update; use typed columns (`model.define`). 
- **Two config files** — prod runs `medusa-config.prod.ts` (Docker cp-overwrites base); register any new module in **both**.
- **Migrations** — hand-write `create table / add column if not exists`; editing an existing `create table if not exists` never lands on existing DBs.
- **Query vs module service** — use **Query** (`query.graph`, resolved from the Medusa container) for cross-module reads; a single-module read can use the module service.

---

## 4. The Autonomous Layer (build first) — JYT mapping

### 4.1 Headline strip + dashboard
Reuse the **#559 analytics** surface. Add a marketing/growth "uber tab" to the admin (or a dedicated `/admin/marketing` route) with the headline strip wired to a `metric_snapshots`-style append-only table. Apply stale-while-revalidate (serve last cached snapshot <100ms, swap in live) — JYT's analytics already does Postgres+Redis batching, so the cache discipline is in place.

### 4.2 Information architecture
Three uber tabs per the spec: **Overview / financials**, **the active campaign**, **Social & Media**. JYT's "active campaign" maps to a quarter's partner-growth or revenue push. The Social & Media tab maps directly onto the **social-platform module** (already has per-provider config + AI fields).

### 4.3 The cron stack (Medusa scheduled jobs)
| Job | Schedule | JYT implementation |
|---|---|---|
| `daily-refresh` | 6am | scheduled job → pull integrations → write `marketing_metric_snapshot` rows → warm caches |
| `daily-ideas-email` | 7am wkdays | scheduled job → AI tactical-ideas email (§4.4) via the email workflow |
| `daily-summary` | 7:05am | post headline + 1 fun fact to Slack **or WhatsApp** |
| `newsletter-daily` / `-weekly` | 5am | draft → save to a `marketing_draft` table for operator review (never auto-send) |
| `subscriber-snapshot` | nightly | list sizes from the marketing/social integrations |

**Pattern to enforce:** every job **writes its result to Postgres before sending anything externally** (if the send fails, the draft survives). This mirrors the #457 dry-run→apply discipline JYT already uses.

### 4.4 The AI tactical-ideas email (highest leverage)
Use the spec's prompt skeleton verbatim, but feed it **real numbers from JYT Postgres** (orders, analytics, partner activations) + the day-over-day delta from snapshots. Build the **hallucination guard** (§7) *before* the first send.

### 4.5 Newsletter generator
AI drafts (subject, preheader, intro, ranking, headers) → operator reviews → operator clicks Send. Persist every draft by name to a `marketing_draft` table. One-click test send. Never fully autonomous.

### 4.6 Comp / promo issuance
JYT analog: issuing a **partner promo, free storefront trial, or comp** — a form that hits the relevant workflow, **writes to `ops_audit`/`audit_log`**, and sends a heads-up email from the verified domain. Never a silent action (JYT already audits guarded ops via #457/#480).

---

## 5. The Operator Layer (build second) — JYT already lives here

This is where JYT is **furthest ahead** of the spec, because the operator-AI-agent + script-library pattern is already how this repo is run:

- **`/scripts` directory** → JYT's `scripts/` + the **ops maintenance-jobs registry (#457)**: guarded, dry-run/apply, per-job param forms, run history, and a **durable audit log (`ops_audit`, #480)**. The spec says "never delete a script — it's an asset that compounds"; #457 already productizes that as an admin **Data Plumbing** console (#485/#508).
- **`replit.md`** → **`.claude/CLAUDE.md`** (style rules, conventions, gotchas) + the file-based memory (every correction encoded as a durable fact).
- **The long-running operator agent** → **Claude Code + the autonomous PR daemon**: fresh-context chunks, verification-gated, encodes corrections into code + memory, survives `/clear` via the #352 handoff protocol. This *is* the spec's "teammate that gets sharper week over week."
- **Hand-tuned outbound (Winbacks / Exec Outreach)** → net-new for JYT: a `marketing_outreach` table + a `WinbacksView` admin component + "Sync from \<email provider\>" + "Log Outreach". Honesty note from the spec: bounce status is unreliable — surface a yellow warning.

---

## 6. Database schema → Medusa modules

A new lightweight **`marketing` module** (or fold into analytics) with typed models — NOT metadata:

```
marketing_metric_snapshot  (append-only headline snapshots for trend lines)
marketing_outreach         (hand-crafted outbound: recipient, company, status, opened_at, replied_at, notes)
marketing_draft            (newsletter/campaign drafts by name, payload jsonb)
marketing_manual_override  (operator corrections to live data, with reason)
marketing_ideas_log        (each generated tactical-ideas email, for recall + A/B)
```
- `audit_log` → **reuse `ops_audit`** (#457/#480) rather than a new table.
- `api_cache` → JYT's analytics caching already covers this pattern.

Each model `model.define()`, registered in **both** config files, with hand-written `if not exists` migrations.

---

## 7. Hallucination + voice guards (build before first AI send)

- **Voice rules live in `CLAUDE.md`** (the `replit.md` analog): house style, the verified send-domain rule, "NET revenue, never gross," etc. The Agent reads it every session.
- **Number guard:** build the prompt with real numbers explicitly listed; pass a token-substitution map (`{TODAY_PAID}`, `{DELTA_DOD}`); after generation, regex-validate every numeric substring against the ground-truth set within tolerance; regenerate once on failure, then flag for human review. **Ship this before the first AI email** — one wrong number to the list erodes trust faster than it can be rebuilt.
- **Date awareness:** pass today's date in the business timezone (IST for JYT) into every prompt.

---

## 8. Security / production hygiene (JYT already enforces most)

- Secrets in **SSM** (not code) — and the Copilot SSM tag requirement applies to any new secret. 
- **Audit every write** → `ops_audit`.
- Retry-with-backoff on every external API call.
- Verify the email sending subdomain on day 1.
- **Read-only credentials by default**; write scopes only for the specific job that needs them.
- A public chatbot (§9) may READ a safe metrics snapshot but must never WRITE.

---

## 9. Public-facing chatbot (optional, last)

A `/marketing-ideas`-style read-only chat for prospects, backed by a cheap model, pulling a **safe** metrics snapshot (never pipeline/partner-private data), rate-limited per IP, prompt-engineered to refuse off-topic. Note: JYT already has a stats public-panel pattern (#341) and read-only share surfaces — reuse that access-control thinking.

---

## 10. Build order (JYT-adapted, ~3 weeks because the platform exists)

**Week 1 — Foundation (mostly assembly)**
- `marketing` module + models + migrations (snapshots, draft, outreach, override, ideas_log), registered in both configs.
- `daily-refresh` scheduled job → write snapshots from orders + analytics + partner activations.
- Headline strip + 1 marketing tab in admin, wired to snapshots (stale-while-revalidate).

**Week 2 — Autonomous layer**
- AI tactical-ideas email **with the hallucination guard first**.
- Daily summary to Slack/WhatsApp.
- Newsletter draft generator (operator-review, manual send).
- Promo/comp issuance form → `ops_audit`.

**Week 3 — Operator layer + compounding**
- `marketing_outreach` table + `WinbacksView` + provider sync.
- Voice rules + team contacts into `CLAUDE.md`; verified-domain rule.
- 2-3 real ad-hoc analysis scripts (use the #457 registry pattern so they're guarded + audited + reusable).
- Stale-while-revalidate everywhere; drill-downs; subscriber growth tracking.

---

## 11. The three things that will trip JYT up (spec's warnings, localized)

1. **Skipping the cache layer** — JYT's analytics already caches; extend that discipline to every marketing dashboard read. Never hit a third-party API on page load.
2. **Letting AI invent numbers** — build the §7 guard before the first send. Non-negotiable.
3. **Treating the agent as a chatbot** — JYT already treats it as a teammate (daemon + memory + CLAUDE.md). Keep encoding every correction; keep the script library compounding.

---

## 12. Gap analysis — what's net-new vs already-built

**Already built / reusable (no new work):** scheduled-job infra, audit log (`ops_audit`), script-library-as-product (#457 registry + Data Plumbing UI), analytics dashboard + caching (#559), LLM wiring (AI SDK/OpenRouter), social-platform integration + AI fields, WhatsApp alerts, institutional memory (`CLAUDE.md` + memory), the operator AI agent (daemon).

**Net-new to build:**
1. `marketing` module + 5 typed models + migrations.
2. `daily-refresh` snapshot job + the marketing admin tab/headline strip.
3. AI tactical-ideas email + **hallucination guard** (the highest-risk, highest-leverage piece).
4. Newsletter draft generator + draft persistence.
5. `marketing_outreach` table + `WinbacksView` + provider sync.
6. Verified sending subdomain + Slack/WhatsApp daily summary.
7. (Optional, last) public read-only marketing chatbot.

**Open product decisions (for the operator):** the One Goal (§1); Slack vs WhatsApp for operator alerts; which email provider verifies the sending subdomain; whether the marketing surface lives in admin or a dedicated route.

---

## 13. Recommended next steps

1. **Operator picks the One Goal** (§1) — blocks the snapshot schema shape.
2. **Day-zero data dump** (§2) into `apps/docs/marketing/historical-data/`.
3. **Daemon (analysis mode)** deepens this into per-slice build specs (one analysis doc per net-new item in §12), then build the `marketing` module slice-by-slice (PR per slice, mirroring the #457/#559 cadence).
4. Build the **hallucination guard + tactical-ideas email** as the first vertical slice — it's the feature that proves the whole pattern.
