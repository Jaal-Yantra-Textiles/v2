# 02 — AI tactical-ideas email + **hallucination guard** (build spec)

**Slice:** §12 net-new item **#3** from
[`AI_VP_MARKETING_JYT_ADAPTATION.md`](./AI_VP_MARKETING_JYT_ADAPTATION.md) §4.4 / §7
(source spec §5.4 + §7.2). **The highest-leverage, highest-risk slice.**
**Tracking issue:** #659. **Status:** build spec (analysis-mode daemon, no code yet).
**Depends on:** slice 1 (`marketing` module + 5 models — spec
[`01_*`](./01_MARKETING_MODULE_AND_MODELS_SPEC.md), PR #666). Specifically it
**reads** `marketing_metric_snapshot` (ground-truth numbers + `delta_dod`) and
**writes** `marketing_ideas_log`. Snapshots are populated by slice 3
(`daily-refresh`); this slice can be developed against hand-seeded snapshot rows.

> **Every path/symbol cited below was grep-verified against the repo on 2026-06-23.**
> The AI call, the email send, the scheduled-job, and the `*-lib.ts` pure-helper
> conventions are copied from existing JYT code — build by *mirroring*, not inventing.

---

## 0. Scope of this slice

A scheduled job that, every weekday morning, (1) reads the latest ground-truth
numbers from `marketing_metric_snapshot`, (2) asks the LLM for 3–5 concrete
tactical moves using a **token-placeholder prompt** (the LLM never emits raw
numbers), (3) runs the output through a **two-layer hallucination guard**
(placeholder substitution + regex ground-truth validation, ±2% tolerance),
(4) **persists every attempt to `marketing_ideas_log` before any send**, and
(5) emails the operator(s) — or, on guard failure, flags-for-review and does
**not** send.

**In scope:** the pure guard library (unit-tested), the AI step, the prompt
builder, the scheduled job, the email send via the existing notification path,
the `marketing_ideas_log` write, and an admin "resend / view log" read route.
**Out of scope (other slices):** the snapshot-producing `daily-refresh` job
(slice 3), the admin dashboard tab (slice 3), the newsletter generator (slice 4),
the public chatbot (last). No new UI page is required for this slice — the daily
email IS the surface; an optional admin read route is listed as the final PR.

---

## 1. ⛔ Blocking product decision (do NOT pick this yourself)

**The One Goal** (report §1) is interpolated into the prompt as `{ONE_GOAL}` and
selects *which* `metric_key` is the headline number. **This slice is buildable
now** against a goal-agnostic prompt — the goal string is read from config
(env `MARKETING_ONE_GOAL` or a `marketing_manual_override`-style settings row),
not hard-coded. **Until the operator picks the goal, keep the job behind a
disable flag** (`MARKETING_IDEAS_EMAIL_ENABLED=false` by default) so it never
sends with a placeholder goal. Surface this in the PR description; do not choose
the goal in code.

Secondary non-blocking decisions (default sensibly, note in PR):
- **Which model.** Default to a cheap model for the daily email (cost: ~daily),
  upgradeable per §4.3. Recommendation: same OpenRouter wiring already in-repo.
- **Recipient list.** Operator admin emails — default to platform admin users;
  a `MARKETING_IDEAS_RECIPIENTS` CSV override is the simplest v1.
- **Email channel/provider.** See §5 — reuse the existing notification path; the
  provider question (Resend vs Maileroo) is a config choice, not new code.

---

## 2. Where this lives (real paths)

```
apps/backend/src/
  workflows/marketing/                         # NEW dir (mirrors workflows/analytics/)
    ├── ideas-email-guard-lib.ts               # PURE guard + prompt helpers (unit-tested) ← the heart
    ├── ideas-email-prompt-lib.ts              # PURE prompt assembly + token map (unit-tested)
    ├── generate-ideas-email.ts                # workflow: gather numbers → AI step → guard → persist
    ├── send-ideas-email.ts                    # workflow: compile template + send (mirrors send-partner-digest-email.ts)
    └── __tests__/
        ├── ideas-email-guard-lib.unit.spec.ts
        └── ideas-email-prompt-lib.unit.spec.ts
  jobs/
    └── daily-ideas-email.ts                   # NEW scheduled job (mirrors aggregate-daily-analytics.ts)
  api/admin/marketing/ideas-log/
    └── route.ts                               # OPTIONAL read route (GET list of ideas-log rows)
integration-tests/http/marketing/
    └── ideas-email-guard.spec.ts              # integration (mirrors analytics specs)
```

**Convention basis (verified):**
- `workflows/analytics/` already co-locates a `*-lib.ts` pure helper next to its
  `send-*.ts` workflow (`partner-digest-email-lib.ts` + `send-partner-digest-email.ts`).
  The `#578` lib-dissolution moved helpers *next to* their workflow — follow that.
- Pure-lib + unit-spec pattern: `modules/partner_billing/compute-fee.ts` (+
  `modules/partner_billing/__tests__/compute-fee.unit.spec.ts`) and
  `workflows/analytics/session-metrics-lib.ts` (+ `__tests__/*.unit.spec.ts`).

---

## 3. The hallucination guard (`ideas-email-guard-lib.ts`) — build this FIRST

Report §7 / source spec §7.2 are non-negotiable: **ship the guard before the
first send.** The guard is pure, framework-free, and fully unit-testable. It
implements **two layers**:

### Layer A — token-placeholder substitution (primary defence)
The LLM is instructed to reference numbers **only** via placeholder tokens
(`{TODAY_GMV}`, `{DELTA_DOD}`, …), never literals. After generation the server
substitutes each placeholder with the ground-truth value formatted for display.
This makes it *impossible* for a placeholder-derived number to be wrong.

### Layer B — stray-literal regex validation (backstop)
Any number-shaped literal the LLM emitted *anyway* (ignoring the instruction) is
extracted by regex and checked against the ground-truth set within **±2%**
tolerance (the source spec's threshold). A stray number with no match → the email
is **flagged and not sent**.

### 3.1 Ground-truth model

```ts
export interface GroundTruthValue {
  token: string          // "TODAY_GMV"
  value: number          // 184320.5  (canonical numeric)
  display: string        // "₹1,84,320"  (what gets substituted into the copy)
  unit?: string | null   // "INR" | "count" | "ratio"
}
export interface GroundTruth {
  values: GroundTruthValue[]   // from marketing_metric_snapshot rows + computed deltas
  date_ist: string             // "2026-06-23" — passed into the prompt (§3.6 of report)
  one_goal: string             // interpolated, not invented
}
```
Built from `marketing_metric_snapshot` rows for `captured_for_date = today` (and
yesterday for deltas) — see §4.1. `delta_dod` is already precomputed on the
snapshot row by slice 3, so the guard never recomputes a delta the dashboard
might disagree with.

### 3.2 Pure functions to implement (all in `ideas-email-guard-lib.ts`)

```ts
// Extract number-shaped substrings. Handles: 1,84,320 / 12.5% / ₹4.5L / $1.2M / -3 / 0.42
export function extractNumericTokens(text: string): Array<{ raw: string; value: number; index: number }>

// Normalize a matched raw token to a canonical number (strip ₹/$/,; expand %, K/L/M/Cr suffixes)
export function parseNumberToken(raw: string): number | null

// Substitute {PLACEHOLDER} → groundTruth.display. Returns { text, substituted: string[], missing: string[] }
// missing = placeholders the LLM used that we have no ground-truth for (→ fail-closed).
export function substitutePlaceholders(text: string, gt: GroundTruth): {
  text: string; substituted: string[]; missing: string[]
}

// Layer B: every stray literal must match some gt value within tolerance.
// Returns failures = [{ token, value, nearest, deviationPct }]; passed = failures.length === 0.
export function validateStrayNumbers(
  text: string, gt: GroundTruth, tolerancePct?: number /* default 2 */
): { passed: boolean; failures: Array<{ token: string; value: number; nearest: number | null; deviationPct: number | null }> }

// Orchestrator over a SINGLE candidate (no I/O): substitute → validate stray → verdict.
export function runGuard(rawOutput: string, gt: GroundTruth, opts?: { tolerancePct?: number }): {
  finalText: string
  passed: boolean
  failures: GuardFailure[]
  substituted: string[]
}
```

**Tolerance / matching rules (encode as tests):**
- A stray literal `v` matches ground-truth `g` iff `|v - g| <= tolerance(g)` where
  `tolerance(g) = max(|g| * 0.02, EPS)` (EPS small constant so exact 0 / small
  counts don't divide-by-zero). The source spec's threshold is **±2%**.
- **Whitelist obviously-safe literals** so the guard isn't trigger-happy: small
  ordinals/list markers `1.`–`5.`, the year (`date_ist`'s year), and a configurable
  allow-list (`%` thresholds like "20%" that are *targets*, not claimed numbers).
  Document each whitelist entry — a too-loose whitelist defeats the guard.
- **Fail closed:** any `missing` placeholder (LLM invented a `{TOKEN}` we don't
  have) OR any unmatched stray literal ⇒ `passed = false`.

### 3.3 Why pure / why typed-log

`runGuard` is deterministic given `(rawOutput, gt)` → trivially unit-testable with
no DB or LLM. The workflow (§4) persists `prompt_snapshot` (the `gt`), `output_text`
(raw), `guard_passed`, and `guard_failures` to `marketing_ideas_log` so every
verdict is **replayable** — this is exactly why slice 1 made it a typed table, not
metadata (`feedback_no_critical_data_in_metadata`).

---

## 4. The generate workflow (`generate-ideas-email.ts`)

A Medusa workflow (mirror `createWorkflow`/`createStep` from
`send-partner-digest-email.ts`). Steps:

### 4.1 Step `gather-ground-truth`
Resolve the `marketing` module service (slice 1) and read today's + yesterday's
snapshot rows:
```ts
const marketing: any = container.resolve(MARKETING_MODULE)
const rows = await marketing.listMarketingMetricSnapshots(
  { captured_for_date: { $gte: startIST, $lte: endIST } },
  { order: { captured_for_date: "DESC" } }
)
```
Map rows → `GroundTruth.values` (value + a `display` formatter; `delta_dod` →
`{DELTA_DOD}`). Compute `date_ist` from the IST business day (report §3.6 — "pass
today's date in the business timezone"). Read `one_goal` from config. Best-effort:
if there are **no snapshots**, abort the run (don't email "₹0") — log + return
`{ skipped: true }`.

### 4.2 Step `ai-generate-ideas`
Mirror the **verified** AI call in
`src/workflows/ad-planning/sentiment/analyze-sentiment.ts:44-71`:
```ts
import { generateText } from "ai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })
const result = await generateText({
  model: openrouter(process.env.MARKETING_IDEAS_MODEL || "anthropic/claude-3.5-sonnet"),
  prompt,                        // from ideas-email-prompt-lib.ts (§4.4)
  maxOutputTokens: 700,
})
const rawOutput = result.text.trim()
```
Wrap in `try/catch` exactly like `analyze-sentiment.ts` — on AI error, return a
`{ generated: false }` StepResponse (no send, log the failure). **Alternative
higher-level wiring** (if per-role model config is wanted instead of a hard-coded
provider): use `getAiPlatformForRole` + `buildChatModel` + `buildGenerateArgs`
from `src/mastra/services/ai-platforms.ts` (this is the in-repo abstraction over
the same `generateText` call; `buildGenerateArgs(system, prompt)` returns the
`{system?, messages}` shape some OpenRouter models require). For v1, the direct
`analyze-sentiment.ts` pattern is simpler and already proven.

### 4.3 Step `run-guard-and-persist`
```ts
import { runGuard } from "./ideas-email-guard-lib"
let verdict = runGuard(rawOutput, gt)
let regenerated = false
if (!verdict.passed) {
  // regenerate ONCE (source spec: "regenerate once on failure, then flag")
  const second = await aiGenerate(prompt + STRICTER_SUFFIX)
  verdict = runGuard(second, gt); regenerated = true
}
await marketing.createMarketingIdeasLogs([{
  generated_for_date: today,
  model_used: modelId,
  prompt_snapshot: gt,                 // json
  output_text: verdict.finalText,
  guard_passed: verdict.passed,
  guard_failures: verdict.failures.length ? verdict.failures : null,
  regenerated,
  sent: false,                          // flipped true only after a successful send
}])
```
**Persist-before-send is mandatory** (report §4.3: "every job writes its result to
Postgres *before* sending anything externally"). The `sent` flag is updated by the
send step only on success.

### 4.4 The prompt (`ideas-email-prompt-lib.ts`, pure)
Implements the source-spec §5.4 skeleton **verbatim in structure**, but with the
hallucination-guard contract baked in:
```ts
export function buildIdeasPrompt(gt: GroundTruth, businessDescription: string): string
```
- Lists every ground-truth value as `LABEL: {TOKEN}` (so the model sees the
  placeholder it must reuse) AND the human display value for context.
- Hard instruction: **"Refer to any number ONLY by its {TOKEN} placeholder.
  Never write a literal number, %, or currency amount. If you need a number that
  is not in the list above, do not use it."**
- Interpolates `{DATE}` = `gt.date_ist`, `{ONE_GOAL}` = `gt.one_goal`.
- Voice rules are read from a constant block (report §7: "voice rules live in
  `CLAUDE.md`" — for v1 embed a `MARKETING_VOICE_RULES` constant; later sourced
  from a settings row). Keep it pure: voice string in, prompt string out.

---

## 5. The send workflow (`send-ideas-email.ts`)

**Mirror `src/workflows/analytics/send-partner-digest-email.ts` exactly** (verified
analog: numbers → Handlebars DB template → notification module → per-recipient
best-effort send). Concretely:

1. Resolve recipients (admin emails / `MARKETING_IDEAS_RECIPIENTS`).
2. `EmailTemplatesService.getTemplateByKey("marketing-ideas-email")`
   (`src/modules/email_templates/service.ts` — **THROWS NOT_FOUND if the row is
   missing or `is_active=false`**, so a `marketing-ideas-email` template row must
   be seeded; see Tests/PR list). Compile with `Handlebars`.
3. `notificationModuleService.createNotifications({ to, channel, template, data })`
   with `_template_html_content / _template_subject / _template_from /
   _template_processed: true` (the documented compiled-template contract).
4. **Channel choice** (config, not new code): the generic
   `send-notification-email.ts` hard-codes `channel:"email"` (Resend); the partner
   path uses `email_partner` (Maileroo). For an **operator-facing** internal email,
   `channel:"email"` (Resend) is correct. ⚠ Base `medusa-config.ts` (what
   integration tests load) only registers `local`+`whatsapp` providers — so the
   integration test asserts the **notification row is created**, not real delivery.
5. On success, update the `marketing_ideas_log` row `sent: true`.
6. **Guard-fail path:** if `guard_passed === false`, **do not send**; instead send
   an internal "⚠ ideas email flagged for review" notice to the operator (or post
   to Slack/WhatsApp — report's alert-channel decision) with a link to the log row.

> Per-recipient send is **best-effort** (mirror the digest step's `try/catch` per
> admin): one bad address never crashes the morning job.

---

## 6. The scheduled job (`jobs/daily-ideas-email.ts`)

Mirror `src/jobs/aggregate-daily-analytics.ts` (verified):
```ts
export default async function dailyIdeasEmail(container: MedusaContainer) {
  if (process.env.MARKETING_IDEAS_EMAIL_ENABLED !== "true") return  // disabled until One Goal picked
  const { result } = await generateIdeasEmailWorkflow(container).run({ input: {} })
  if (result?.shouldSend) await sendIdeasEmailWorkflow(container).run({ input: { logId: result.logId } })
}
export const config = {
  name: "daily-ideas-email",
  schedule: "0 7 * * 1-5",   // 7am IST weekday mornings (source spec §5.4). Confirm server TZ; see watch-out.
}
```
- Schedule string cadence proven by `aggregate-daily-analytics.ts` (`"0 1 * * *"`)
  and `process-email-queue.ts` (`"0 6 * * *"`). **Watch-out:** Medusa cron runs in
  the server's timezone — if prod runs UTC, `7am IST = 01:30 UTC` (`"30 1 * * 1-5"`).
  Verify against how existing jobs interpret their schedule before locking the cron.
- Generate and send are **separate workflows** so a failed send doesn't lose the
  generated+guarded draft (it's already in `marketing_ideas_log`; the admin route
  in §7 can re-trigger a send).

---

## 7. Optional admin read route (final PR)

`GET /admin/marketing/ideas-log` — list recent `marketing_ideas_log` rows
(date, model, guard_passed, sent, failures) so the operator can audit what was
sent and inspect guard failures. Mirror an existing admin list route shape
(e.g. the partner_billing fees route `src/api/admin/partners/[id]/fees/route.ts`).
A `POST .../ideas-log/:id/resend` (guarded, writes nothing AI — just re-sends an
already-guard-passed row) is a nice-to-have; defer if time-boxed. **No React UI in
this slice** (the email is the surface); a dashboard card is slice 3.

---

## 8. Tests to write

**Unit (pure, run per-file: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern=ideas-email-guard`):**
- `ideas-email-guard-lib.unit.spec.ts` — the bulk of the value:
  - `extractNumericTokens` / `parseNumberToken`: `1,84,320` → 184320; `12.5%` → 12.5;
    `₹4.5L` → 450000; `$1.2M` → 1200000; `-3`; `0.42`; ignores `1.`/`2.` list markers.
  - `substitutePlaceholders`: replaces known tokens; reports `missing` for unknown
    `{TOKEN}` (fail-closed).
  - `validateStrayNumbers`: in-tolerance literal passes (±2%); out-of-tolerance
    fails with correct `deviationPct`; whitelisted year/ordinal ignored; exact-0
    ground truth doesn't divide-by-zero.
  - `runGuard`: clean placeholder-only text passes; a stray hallucinated number
    fails and is reported; substitution applied to `finalText`.
- `ideas-email-prompt-lib.unit.spec.ts` — prompt contains every `{TOKEN}`, the
  date, the goal, the "numbers only as placeholders" instruction; deterministic
  given input.

**Integration (per-file: `pnpm test:integration:http:shared -- integration-tests/http/marketing/ideas-email-guard.spec.ts`):**
- Seed `marketing_metric_snapshot` rows via the module service; run the generate
  workflow with a **stubbed AI step** (inject a fake `rawOutput`) — assert: a
  `marketing_ideas_log` row is written *before* send; a clean output → `guard_passed`,
  `sent` flips true, a notification row exists; a hallucinated output → `guard_passed=false`,
  `sent=false`, no operator-facing send. (Stub the LLM — never call OpenRouter in CI.)
- Seed the `marketing-ideas-email` email template row (or assert graceful skip when
  missing, matching the digest step's best-effort behaviour).

**Do NOT** run the whole integration dir (Medusa `CREATE INDEX CONCURRENTLY` vs
TRUNCATE boot deadlock) — per-file only.

---

## 9. Ordered PR list (one slice each; stack only if same registry file)

1. **PR-1 — the guard library (pure) + unit tests.** `ideas-email-guard-lib.ts` +
   `ideas-email-prompt-lib.ts` + both `*.unit.spec.ts`. **No wiring.** This is the
   highest-value, lowest-risk PR — it can land and be trusted independently. Ship
   this first; everything else depends on it.
2. **PR-2 — generate workflow** (`generate-ideas-email.ts`) writing
   `marketing_ideas_log`, with a **stubbed/injectable AI step** + integration test
   (no real LLM). Depends on PR-1 + slice 1.
3. **PR-3 — send workflow** (`send-ideas-email.ts`) mirroring
   `send-partner-digest-email.ts` + seed the `marketing-ideas-email` template row
   + integration test asserting the notification row + `sent` flip.
4. **PR-4 — scheduled job** (`jobs/daily-ideas-email.ts`) behind
   `MARKETING_IDEAS_EMAIL_ENABLED` (default off). Wires PR-2 → PR-3. Confirm cron TZ.
5. **PR-5 (optional) — admin read route** `GET /admin/marketing/ideas-log` (+ resend).

PRs 2–4 are independent files (no shared registry) → branch each off `origin/main`.
None edits a central registry array, so **no stacking** is needed (unlike the
`MAINTENANCE_JOBS` series). The email-template seed in PR-3 is its own
file/migration.

---

## 10. The exact existing JYT primitives this slice reuses (cite-checked)

| Need | Reuse (verified path) |
|---|---|
| AI text generation | `generateText` + `createOpenRouter({apiKey: OPENROUTER_API_KEY})` — pattern in `src/workflows/ad-planning/sentiment/analyze-sentiment.ts:44-71` |
| Per-role model config (alt) | `getAiPlatformForRole` / `buildChatModel` / `buildGenerateArgs` in `src/mastra/services/ai-platforms.ts`; provider `src/mastra/providers/openrouter.ts` |
| Numbers→email workflow | `src/workflows/analytics/send-partner-digest-email.ts` (+ pure `partner-digest-email-lib.ts`) — the closest analog |
| Email template fetch/compile | `EmailTemplatesService.getTemplateByKey` (`src/modules/email_templates/service.ts`) + Handlebars + `notificationModuleService.createNotifications({to,channel,template,data})` with `_template_*` fields |
| Generic (Resend) send | `src/workflows/email/workflows/send-notification-email.ts` (hard-codes `channel:"email"`) |
| Scheduled job shape | `src/jobs/aggregate-daily-analytics.ts` (`export default async fn(container)` + `export const config={name,schedule}`); `src/jobs/process-email-queue.ts` |
| Pure-lib + unit-spec convention | `modules/partner_billing/compute-fee.ts`, `workflows/analytics/session-metrics-lib.ts` (+ `__tests__/*.unit.spec.ts`) |
| Ground-truth source + log sink | slice-1 models `marketing_metric_snapshot`, `marketing_ideas_log` ([`01_*`](./01_MARKETING_MODULE_AND_MODELS_SPEC.md)) |
| Audit of any guarded send | `ops_audit` (`ops_maintenance_run`) per report §6 — reuse, don't add a table |

---

## 11. Watch-outs (from platform memory)

- **No load-bearing data in `metadata`** — `prompt_snapshot`/`guard_failures` are
  typed `json()` columns on `marketing_ideas_log`, not order/notification metadata
  (`feedback_no_critical_data_in_metadata`).
- **Two config files** — the `marketing` module (slice 1) must already be in BOTH
  `medusa-config.ts` + `.prod.ts`; this slice adds no new module.
- **Email providers differ by config file** — base `medusa-config.ts` (integration
  tests) only has `local`+`whatsapp` providers; real Resend/Maileroo live in
  `.prod.ts`/`.dev.ts`. So integration tests assert the *notification row*, not
  delivery (CODEBASE_MAP "Email / notification system").
- **Template must exist + be active** — `getTemplateByKey` throws NOT_FOUND on a
  missing/inactive row; seed `marketing-ideas-email` (PR-3) and prod-verify it's
  active (`GET https://v3.jaalyantra.com/admin/email-templates?limit=100`).
- **Cron timezone** — confirm server TZ before trusting `"0 7 * * 1-5"` means 7am IST.
- **Never call the live LLM in CI** — inject the AI output in tests (the step must
  be injectable/stubbable, like the `execOp` injection pattern used elsewhere).
- **Fail closed, regenerate once** — on guard failure, regenerate exactly once then
  flag-no-send (source spec §7.2). A wrong number to the list erodes trust faster
  than it can be rebuilt (report §11.2).

---

## 12. Definition of done

- `runGuard` passes a unit suite covering ±2% tolerance, placeholder substitution,
  stray-literal detection, whitelist, and fail-closed behaviour.
- The generate workflow writes a `marketing_ideas_log` row **before** any send,
  with `guard_passed`/`guard_failures`/`prompt_snapshot` populated.
- A guard-failed run does **not** send the ideas email (sends a review notice).
- The job is disabled by default and only enabled after the One Goal is chosen.
- Per-file unit + integration specs green; zero new typecheck errors on changed files.
