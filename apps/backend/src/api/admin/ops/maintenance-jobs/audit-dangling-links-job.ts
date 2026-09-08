import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #1857 — the dangling-pointer sweep, re-run so it ranks by what is
 * UNEXPLAINED rather than by row count.
 *
 * WHY THE FIRST TWO SWEEPS RANKED THE WRONG THINGS
 * ------------------------------------------------
 * They measured "how many rows point at a target the graph cannot see" and
 * sorted by the number. Both clusters that came top were then investigated and
 * neither was a defect:
 *
 *   pricing_price_fx_rates_fx_price_meta   215/610  a variant price save
 *     REPLACES the whole price set, so FX markers outlive their prices. The one
 *     reader already skips them; `compact-fx-price-meta` prunes them.
 *   partner_quote.price_list_id             10/12   `revokeQuote` DELETES the
 *     price list. A revoked quote pointing at a deleted list is the DESIGNED
 *     terminal state.
 *
 * 🔑 A sweep asking "does the target resolve" cannot tell a DANGLING pointer
 * from a DELIBERATELY SEVERED one — severing a pointer is how several systems
 * here express *revoked*, *superseded*, *expired*. So this one carries a
 * classification table with a written reason per entry, reports the classified
 * pairs separately, and ranks only the rest.
 *
 * An entry in that table is a CLAIM about the code, and it is the only part of
 * this job that can rot. Each one names the function that does the severing.
 *
 * 🔴 VISIBILITY, not existence. A soft-deleted target resolves to the same
 * absent join as a hard-deleted one, and asking the other question is what
 * made the first sweeps undercount — the corrected prod figure went from 27
 * pairs to 46.
 *
 * 🔴 A pair that could not be measured is reported as UNMEASURED, never folded
 * into the clean ones. A check that never ran reads as a pass, and on a sweep
 * whose whole output is "these are fine" that is the worst available failure.
 */

export const MAX_PAIR_SCAN = 1000
/** Per-pair statement timeout. A slow pair becomes `unmeasured`, not `clean`. */
export const PAIR_TIMEOUT_MS = 15000

export type PairClass = "tombstone" | "external_id" | "core" | "unexplained"

export type Classification = {
  klass: Exclude<PairClass, "unexplained">
  /** Why, naming the code that does it. Read as a claim that can go stale. */
  reason: string
}

/**
 * What we already know about, keyed `table.column`.
 *
 * 🔴 Every `tombstone` entry names the function that severs the pointer. When
 * one of these is wrong the sweep goes quiet about a real defect, so the
 * citation is the only thing making it checkable.
 */
export const CLASSIFIED: Record<string, Classification> = {
  "partner_quote.price_list_id": {
    klass: "tombstone",
    reason:
      "revokeQuote (modules/partner-quote/lib/revoke-quote.ts) DELETES the price list and sets status='revoked'. A revoked quote pointing at a deleted list is the designed terminal state — the list is destroyed so the quote can never price again.",
  },
  "pricing_price_fx_rates_fx_price_meta.price_id": {
    klass: "tombstone",
    reason:
      "updateProductVariantsWorkflow replaces the whole price set, so an FX marker outlives the price it marks. rerate-auto-converted-prices already skips these; compact-fx-price-meta prunes them.",
  },

  // Ids that belong to someone else's system and happen to share a name with a
  // local table. Measured at 100% 'dangling' precisely because they never
  // pointed here in the first place.
  "lead.form_id": {
    klass: "external_id",
    reason: "Meta/ads form id — an external identifier, not a local `form` row.",
  },
  "lead.ad_id": {
    klass: "external_id",
    reason: "Meta/ads ad id — an external identifier, not a local `ad` row.",
  },
  "conversion.analytics_session_id": {
    klass: "external_id",
    reason:
      "Analytics session id from the tracking payload — not a local `analytics_session` row.",
  },

  // Medusa's own tables. Excluded by decision in #1857: core copes with its
  // own lifecycle, and we do not own the writers.
  "cart.customer_id": { klass: "core", reason: "Medusa core owns this lifecycle." },
  "product_product_option.product_id": {
    klass: "core",
    reason: "Medusa core owns this lifecycle.",
  },
  "product_product_option.product_option_id": {
    klass: "core",
    reason: "Medusa core owns this lifecycle.",
  },
}

export type PairMeasurement = {
  table: string
  column: string
  target: string
  /** Rows with a non-null pointer (live source rows only). */
  total: number
  /** Of those, how many point at a target the graph cannot see. */
  orphans: number
  /**
   * One of the offending pointer values, verbatim.
   *
   * 🔴 This exists because three sweeps in a row put a NON-defect on top and
   * the count could not say so. `payment_schedule.cart_id` read 23 of 27 —
   * and every one of the 23 was `cart_e2e_<stamp>`, fabricated by
   * `e2e/helpers/e2e-seed.ts`, which needs a text key and not a cart. Prod
   * holds 4 rows and 0 orphans. A single sample value answers in one glance
   * the question the count takes a session to answer: is this a pointer that
   * broke, or a string that was never a pointer?
   */
  sample: string | null
}

/** PURE: how a measured pair is classified. Exported for unit tests. */
export function classifyPair(table: string, column: string): PairClass {
  return CLASSIFIED[`${table}.${column}`]?.klass ?? "unexplained"
}

/**
 * PURE: the operator-facing line for one pair.
 *
 * 🔴 A 100% orphan rate is the signature of an EXTERNAL id, not of a
 * catastrophe — every one of the known false positives measured 100%. Saying
 * so on the line is what stops the next reader ranking it first all over
 * again.
 *
 * 🔴 And the line carries a SAMPLE VALUE, because the rate is not always the
 * tell. `payment_schedule.cart_id` measured 23 of 27 — a partial rate, no
 * classification, top of the sweep — and the sample would have read
 * `cart_e2e_1787467149960`: an id the e2e seed fabricates, in a database that
 * is not prod. Three sweeps have now been topped by something that was not a
 * defect. Two of them were answered by reading code; this one is answered by
 * looking at the string.
 */
export function describePair(m: PairMeasurement, klass: PairClass): string {
  const pct = m.total ? Math.round((m.orphans / m.total) * 100) : 0
  const shape =
    pct === 100
      ? " — 100%, the signature of an id that never pointed here"
      : ""
  const known = CLASSIFIED[`${m.table}.${m.column}`]
  // The value itself, because a count cannot tell a broken pointer from a
  // string that was never one — and the shape of the id usually can.
  const sample = m.sample ? ` · e.g. \`${m.sample}\`` : ""
  return `${m.orphans} of ${m.total} point at a ${m.target} that is not visible (${pct}%)${shape}${sample}${
    known ? ` · ${klass}: ${known.reason}` : ""
  }`
}

const paramsSchema = z.object({
  limit: z.number().int().positive().max(MAX_PAIR_SCAN).optional().default(MAX_PAIR_SCAN),
  /** Report a pair only at or above this many orphans. */
  min_orphans: z.number().int().min(1).optional().default(1),
  /** Include the pairs we already have an answer for. Off by default. */
  include_classified: z.boolean().optional().default(false),
})

/** Candidate `(table, column) → target` pairs, discovered from the catalog. */
const DISCOVERY_SQL = `
with cols as (
  select c.table_name, c.column_name,
         regexp_replace(c.column_name, '_id$', '') as base
  from information_schema.columns c
  join information_schema.tables t
    on t.table_name = c.table_name and t.table_schema = 'public'
   and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
    and c.column_name like '%\\_id'
    and c.data_type in ('text', 'character varying')
),
resolved as (
  select distinct on (cols.table_name, cols.column_name)
         cols.table_name, cols.column_name, tt.table_name as target
  from cols
  join information_schema.tables tt
    on tt.table_schema = 'public' and tt.table_type = 'BASE TABLE'
   and tt.table_name in (cols.base, cols.base || 's', regexp_replace(cols.base, 's$', ''))
  join information_schema.columns tid
    on tid.table_schema = 'public' and tid.table_name = tt.table_name
   and tid.column_name = 'id'
  where tt.table_name <> cols.table_name
  order by cols.table_name, cols.column_name,
           -- prefer the exact name over a pluralised guess
           (tt.table_name = cols.base) desc
)
select table_name, column_name, target,
       exists (select 1 from information_schema.columns d
                where d.table_schema='public' and d.table_name = resolved.table_name
                  and d.column_name='deleted_at') as src_soft_deletes,
       exists (select 1 from information_schema.columns d
                where d.table_schema='public' and d.table_name = resolved.target
                  and d.column_name='deleted_at') as tgt_soft_deletes
from resolved
order by table_name, column_name
`

export const auditDanglingLinksJob: MaintenanceJob = {
  id: "audit-dangling-links",
  label: "Audit dangling pointers, ranked by what is unexplained",
  description:
    "Read-only. Walks every `<x>_id` column whose implied table exists and counts the rows pointing at a target query.graph cannot see — counting a soft-deleted target as invisible, because a reader cannot tell it from a missing one. Pairs with a written explanation (a deliberate tombstone like revokeQuote deleting its price list, an external id that merely shares a name, or a Medusa-core table) are classified and reported separately, so the ranking is by UNEXPLAINED rows rather than by rows. A pair that cannot be measured in time is reported as unmeasured, never as clean. Writes nothing in either mode.",
  params: [
    { name: "limit", type: "number", required: false, description: `Max pairs to measure (default & max ${MAX_PAIR_SCAN})` },
    { name: "min_orphans", type: "number", required: false, description: "Only report pairs with at least this many orphans (default 1)" },
    { name: "include_classified", type: "boolean", required: false, description: "Also list the pairs that already have an explanation (default false)" },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { limit, min_orphans, include_classified } = parsed.data

    const pg: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    const discovered = (await pg.raw(DISCOVERY_SQL))?.rows ?? []
    const pairs = discovered.slice(0, limit)

    const changes: MaintenanceChange[] = []
    const unmeasured: Array<{ id: string; message: string }> = []
    let measured = 0
    let unexplainedOrphans = 0
    let classifiedOrphans = 0

    for (const p of pairs) {
      const src = String(p.table_name)
      const col = String(p.column_name)
      const tgt = String(p.target)
      const srcLive = p.src_soft_deletes ? `and s."deleted_at" is null` : ""
      const tgtLive = p.tgt_soft_deletes ? `and t."deleted_at" is null` : ""

      const sql = `
        select
          count(*) filter (where s."${col}" is not null) as total,
          count(*) filter (where s."${col}" is not null and t."id" is null) as orphans,
          min(s."${col}") filter (where s."${col}" is not null and t."id" is null) as sample
        from "${src}" s
        left join "${tgt}" t on t."id" = s."${col}" ${tgtLive}
        where true ${srcLive}
      `

      let row: any
      try {
        /*
         * 🔴 A per-statement timeout, and a timeout is an ERROR not a zero.
         * Some of these tables are large in prod; a pair that quietly returned
         * 0 because it gave up would read exactly like a clean one, on a job
         * whose entire output is a list of things that are fine.
         */
        await pg.raw(`set local statement_timeout = ${PAIR_TIMEOUT_MS}`)
        row = (await pg.raw(sql))?.rows?.[0]
      } catch (e: any) {
        unmeasured.push({ id: `${src}.${col}`, message: e?.message ?? String(e) })
        continue
      }

      measured += 1
      const m: PairMeasurement = {
        table: src,
        column: col,
        target: tgt,
        total: Number(row?.total ?? 0),
        orphans: Number(row?.orphans ?? 0),
        sample: row?.sample == null ? null : String(row.sample),
      }
      if (m.orphans < min_orphans) {
        continue
      }

      const klass = classifyPair(src, col)
      if (klass === "unexplained") {
        unexplainedOrphans += m.orphans
      } else {
        classifiedOrphans += m.orphans
        if (!include_classified) {
          continue
        }
      }

      changes.push({
        entity: klass === "unexplained" ? "dangling" : `known:${klass}`,
        id: `${src}.${col}`,
        field: `→ ${tgt}`,
        before: m.orphans,
        after: m.total,
        note: describePair(m, klass),
      })
    }

    // Worst first, and only among the ones nobody has explained yet.
    changes.sort((a, b) => Number(b.before ?? 0) - Number(a.before ?? 0))

    const unexplainedPairs = changes.filter((c) => c.entity === "dangling").length
    const summary =
      `Measured ${measured} of ${discovered.length} pointer pair(s): ` +
      `${unexplainedPairs} unexplained pair(s) holding ${unexplainedOrphans} row(s), ` +
      `${classifiedOrphans} row(s) in pairs that already have a written explanation` +
      (unmeasured.length ? `, ${unmeasured.length} UNMEASURED (timed out — not clean, unknown)` : "")

    return {
      job_id: auditDanglingLinksJob.id,
      dry_run,
      // Read-only: there is nothing to apply, in either mode.
      applied: false,
      summary,
      changes,
      errors: unmeasured.length ? unmeasured : undefined,
    }
  },
}
