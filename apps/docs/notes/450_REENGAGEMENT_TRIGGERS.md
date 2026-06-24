# #450 — Re-engagement email triggers

PR #715 seeded four re-engagement email templates (`win-back`, `back-in-stock`,
`browse-abandonment`, `feedback-reminder`) and wired **only** `feedback-reminder`
(the daily `send-feedback-reminders` job). This note tracks the remaining three.

| Trigger | Status | Mechanism |
|---|---|---|
| `feedback-reminder` | ✅ wired (#715) | daily job `send-feedback-reminders` |
| `win-back` | ✅ wired (this PR) | weekly job `send-winback-emails` |
| `back-in-stock` | 📐 design-scoped | needs opt-in capture (no signal exists) |
| `browse-abandonment` | 📐 design-scoped | needs analytics→customer link (PII gap) |

All wired triggers follow the same shape: a **pure selector lib** (unit-tested,
no container deps) + a **scheduled job / subscriber** + an **idempotent metadata
stamp** + the Medusa **logger** + **fail-soft** sends (missing template /
recipient / provider error for one row never aborts the batch).

---

## ✅ win-back (wired in this PR)

- **Selector:** `src/workflows/reengagement/lib/winback.ts`
  - `selectWinbackDue(rows, { now, minLapsedDays, cooldownDays, maxBatch })` —
    keeps customers who have ≥1 order, an email, a most-recent order older than
    `minLapsedDays`, and who are **not** within the win-back cooldown.
  - `buildWinbackEmailData(...)` — assembles the `win-back` Handlebars payload
    (`customer_name`, `last_order_display`, `days_since`, `shop_url`,
    `current_year`). `discount_code` is intentionally omitted (template hides it).
  - `humanizeDaysSince` / `winbackOnCooldown` helpers.
- **Job:** `src/jobs/send-winback-emails.ts` — weekly (`0 11 * * 1`).
  - Lists `has_account` customers (`Modules.CUSTOMER`), fetches their orders
    (`Modules.ORDER`, `customer_id: { $in }`), reduces to per-customer
    count + latest order, runs the selector, sends `win-back`, then stamps.
- **Idempotency:** `customer.metadata.winback_sent_at` (ISO). A customer is only
  re-eligible once `WINBACK_COOLDOWN_DAYS` elapse — survives re-runs and the
  still-lapsed-next-cycle case.
- **Config (env):** `WINBACK_MIN_LAPSED_DAYS` (90), `WINBACK_COOLDOWN_DAYS`
  (180), `WINBACK_MAX_BATCH` (100), `WINBACK_MAX_SCAN` (2000).
- **Independence:** this is the **lifecycle** email trigger and is deliberately
  separate from #659's churn-based `marketing_outreach` exec-outreach pipeline
  (`modules/marketing/winback-targets-lib.ts`). They target different audiences
  (all lapsed buyers vs. high-churn-risk Persons curated for hand-crafted
  outreach) and must not be merged or they'd double-send.

---

## 📐 back-in-stock (design-scoped — no opt-in signal yet)

**Why not wired:** the template needs a "this customer wanted this OOS item"
signal, and **none exists** today. There is no back-in-stock request / notify-me
model, and no subscriber listens to inventory-level changes
(`grep back_in_stock|notify.me|restock src/` → only the seed script).

**Minimal build (next slice):**
1. **Opt-in capture** — a `stock_notification_request` model
   (`email`, `variant_id` or `inventory_item_id`, `product_title`, `status`,
   `notified_at`) + migration, and a public `POST /web/stock-notifications`
   route the sold-out PDP calls when a shopper clicks "notify me".
2. **Restock subscriber** — subscribe to the inventory level event Medusa emits
   when stock goes 0 → positive. Confirm the exact event name first:
   candidates are `inventory-item.updated` and a `InventoryServiceEvents`
   reservation/level event in `@medusajs/inventory`. If no 0→positive event is
   emitted, fall back to a scheduled sweep that diffs current stock against the
   pending requests.
3. **Pure selector** `selectBackInStockReady(requests, levels)` → requests whose
   item is now in stock and not yet notified; **stamp** `notified_at` (idempotent).
4. Send `back-in-stock`; fail-soft on missing template / email.

---

## 📐 browse-abandonment (design-scoped — analytics is PII-free)

**Why not wired:** the analytics module is deliberately privacy-first.
`analytics_session` / `analytics_event` (`modules/analytics/models/`) key on a
hashed `visitor_id` and explicitly store **no PII** — there is **no link from a
session/visitor to a customer email**. So "match a product-viewing session to a
known customer and email them" cannot be done honestly today (would be a
half-working send, which the brief says to avoid).

**What it would take:**
1. An **identity bridge** — capture a (hashed-visitor_id → customer email) link
   at a consented identification point (login / newsletter opt-in / checkout
   start), stored in a dedicated opt-in table, **not** by adding PII to the
   analytics tables.
2. A scheduled job that finds recent sessions with product pageviews but no
   `add_to_cart` custom event, joins through the bridge to an email, and applies
   a per-visitor cooldown stamp.
3. Pure selector `selectBrowseAbandoners(sessions, events, identities, opts)`.

Until the consented identity bridge exists, this stays template-only.
