import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { GraphBuilder } from "../builder"
import type { Graph, GraphNode, NodeAct, NodeItem, SpineContext } from "../types"
import { OPS_AUDIT_MODULE } from "../../../modules/ops_audit"

/**
 * The dangling-pointer board (#1857).
 *
 * Every `<x>_id` column in the database that points at something the graph
 * cannot see, drawn as one canvas: what the sweep found, ranked, with the
 * evidence attached and — where a written fixer exists — the data-ops job that
 * repairs it, runnable from the node that states the problem.
 *
 * ## Why it reads the last RUN rather than sweeping on open
 *
 * `audit-dangling-links` measures 456 pointer pairs with a per-pair timeout.
 * Re-running that on every page load would make a board somebody opens
 * casually into the most expensive request in the admin, and it would still
 * only ever show one moment.
 *
 * The sweep already persists its complete result: `ops_maintenance_run` stores
 * the FULL `changes` JSON of every run, dry or applied (#457). So the board is
 * a reader of the audit log, opens instantly, and — this is the part that
 * matters — **states how old its reading is**. A number with no timestamp and
 * no database attached is what let a local measurement get written into a
 * handoff as a fact about production. The spine node says when, and by whom.
 *
 * ## Why an empty board is impossible
 *
 * 🔴 If no sweep has ever run, this does NOT return an empty graph. An empty
 * graph is indistinguishable from "nothing dangles", which is the single most
 * dangerous thing this board could say. It returns one absent node — "no sweep
 * recorded" — carrying the act that runs one. Same rule the queue registry
 * applies to an unknown queue name, for the same reason.
 */

/** `job_id` of the sweep whose output this board draws. */
export const SWEEP_JOB_ID = "audit-dangling-links"

/**
 * The written fixers, keyed `table.column`.
 *
 * 🔴 There is deliberately NO generic "null the dangling pointer" job here,
 * and the board must never grow one. Three sweeps running have been topped by
 * a pair that was not a defect — a revoked quote whose price list is DELETED
 * on purpose, an FX marker outliving a replaced price set, and a column full
 * of ids an e2e fixture invented. A button that nulls whatever the sweep
 * ranked first would have destroyed correct state on all three, and it would
 * have looked like tidying up.
 *
 * A pair earns an act only once somebody has written down what its rows mean
 * and shipped a job that acts on that meaning. Everything else gets evidence
 * and no button, which is the honest offer.
 */
export const FIXERS: Record<string, { job: string; label: string; confirm: string }> = {
  "pricing_price_fx_rates_fx_price_meta.price_id": {
    job: "compact-fx-price-meta",
    label: "Compact the stale FX markers",
    confirm:
      "Deletes the FX price markers whose price no longer exists. A variant price save replaces the whole price set, so these mark prices that were REPLACED, not lost — the rerate job already skips them. Preview first; the preview lists every marker it would remove.",
  },
}

/**
 * How a maintenance job is offered on a node.
 *
 * Both bodies are built here, on the server, for the same reason `remove.path`
 * is: the client must never assemble a call to a job endpoint out of ids it
 * half-understands. Preview is `dry_run: true` and is what the button does
 * first; apply is a second, separately confirmed call.
 */
const jobAct = (jobId: string, label: string, confirm: string): NodeAct => ({
  method: "POST",
  path: `/admin/ops/maintenance-jobs/${jobId}/run`,
  previewBody: { dry_run: true },
  applyBody: { dry_run: false },
  label,
  confirm,
})

/** Re-running the sweep is itself an act, and a read-only one. */
const sweepAct = (label: string): NodeAct => ({
  ...jobAct(SWEEP_JOB_ID, label, ""),
  /*
   * 🔴 No apply step. The sweep writes nothing in either mode — `applied` is
   * hard-coded false — so offering "apply" would invent a destructive-looking
   * second press for a job that has no second behaviour.
   */
  applyBody: null,
  confirm: "",
})

type SweepRun = {
  id: string
  actor_id: string
  summary: string
  created_at: string | Date
  changes: Array<{
    entity: string
    id: string
    field?: string
    before?: unknown
    after?: unknown
    note?: string
  }>
}

/** The newest recorded run of the sweep, or null if it has never been run. */
const latestSweep = async (scope: any): Promise<SweepRun | null> => {
  const audit: any = scope.resolve(OPS_AUDIT_MODULE)
  /*
   * `listOpsMaintenanceRuns`, not `listAndCount` — the latter returns a TUPLE
   * and reading `[0]` off it yields the whole rows array, not a row. That
   * exact confusion silently broke every weaver edit in #1864.
   */
  const rows = await audit.listOpsMaintenanceRuns(
    { job_id: SWEEP_JOB_ID },
    { order: { created_at: "DESC" }, take: 1 }
  )
  const row = Array.isArray(rows) ? rows[0] : null
  return row ? ({ ...row, changes: Array.isArray(row.changes) ? row.changes : [] } as SweepRun) : null
}

const pct = (orphans: number, total: number) =>
  total ? Math.round((orphans / total) * 100) : 0

/**
 * PURE: one measured pair → its node.
 *
 * Exported for tests, because every judgement the board makes about a pair is
 * in here and none of it is visible from a screenshot.
 */
export const pairNode = (change: SweepRun["changes"][number]): GraphNode => {
  const orphans = Number(change.before ?? 0)
  const total = Number(change.after ?? 0)
  const explained = change.entity.startsWith("known:")
  const fixer = FIXERS[change.id]

  return {
    key: `pair:${change.id}`,
    type: "pointer-pair",
    label: change.id,
    /*
     * 🔴 The COUNT has to be in here, and this was only visible by rendering.
     *
     * The canvas draws `sublabel ?? count` — the sublabel WINS — so a node
     * whose sublabel was just the target read `→ cart` and nothing else. The
     * board's entire claim is that it ranks pairs by how many rows are
     * unexplained, and on a radial canvas there is no order: a 23-row pair and
     * a 1-row pair were the same box. The number was in the payload, in the
     * drawer, and nowhere a reader would look first.
     */
    sublabel: `${orphans} of ${total} ${change.field ?? ""}`.trim(),
    /*
     * 🔴 `absent` means the model expected a neighbour and there is none —
     * exactly what an unexplained dangling pointer is, and it draws red.
     *
     * An EXPLAINED pair is a compromise, and worth naming as one. Its target
     * is just as gone, so `present` would be a lie; but the absence is the
     * design — `revokeQuote` DELETES the price list so the quote can never
     * price again — so drawing it red beside the real defects would restore
     * the exact ranking this sweep was rewritten to remove. `derived` is the
     * least-wrong of the three states the canvas can draw: not a live link,
     * not an alarm, and the edge reason carries the actual explanation. A
     * fourth state would be more honest and would ripple through the canvas
     * palette, the summary counts and four other spines.
     */
    state: explained ? "derived" : "absent",
    count: orphans,
    status: explained ? change.entity.replace("known:", "") : "unexplained",
    /* No page exists for a `table.column`. The evidence is the drawer. */
    href: null,
    props: [
      { key: "Rows pointing at nothing", value: String(orphans) },
      { key: "Rows with a pointer", value: String(total) },
      { key: "Rate", value: `${pct(orphans, total)}%` },
    ],
    action: null,
    act: fixer ? jobAct(fixer.job, fixer.label, fixer.confirm) : null,
  }
}

export const resolveDanglingPointers = async (ctx: SpineContext): Promise<Graph> => {
  const run = await latestSweep(ctx.scope)
  const b = new GraphBuilder("dangling")

  if (!run) {
    /*
     * 🔴 Never an empty graph. "No sweep has run" and "nothing dangles" are
     * opposite facts that would render identically.
     */
    b.push(
      {
        key: "sweep",
        type: "sweep",
        label: "No sweep recorded",
        sublabel: null,
        state: "absent",
        count: 0,
        status: null,
        href: null,
        props: [{ key: "Job", value: SWEEP_JOB_ID }],
        action: null,
        act: sweepAct("Run the sweep"),
      },
      {
        label: SWEEP_JOB_ID,
        state: "absent",
        reason:
          "This board reads the last recorded run of the dangling-pointer sweep, and there has never been one. It is not a statement that nothing dangles.",
      }
    )

    return b.build({
      key: "dangling",
      type: "board",
      label: "Dangling pointers",
      sublabel: "never swept",
      state: "present",
      count: 0,
      status: null,
      href: null,
      props: [{ key: "Last swept", value: "never" }],
      action: null,
      act: sweepAct("Run the sweep"),
    })
  }

  const sweptAt = new Date(run.created_at)
  for (const change of run.changes) {
    const node = pairNode(change)
    b.push(node, {
      label: String(change.id).split(".").slice(1).join(".") || String(change.id),
      state: node.state,
      /*
       * The sweep's own sentence, verbatim — count, rate, the 100%
       * external-id signature, a SAMPLE of the offending value, and the
       * classification reason where there is one. Re-phrasing it here would
       * give that sentence a second home and let the two drift.
       */
      reason: change.note ?? null,
    })
  }

  const unexplained = run.changes.filter((c) => !c.entity.startsWith("known:"))
  const unexplainedRows = unexplained.reduce((n, c) => n + Number(c.before ?? 0), 0)

  return b.build({
    key: "dangling",
    type: "board",
    label: "Dangling pointers",
    sublabel: `swept ${sweptAt.toISOString().slice(0, 16).replace("T", " ")}`,
    /*
     * 🔴 `present`, never `absent`, and rendering is what said so. The drawer
     * badges an absent node with the red word "absent", so a board keyed on
     * whether it had findings introduced itself as "Dangling pointers ·
     * absent" — which is not a fact about anything. The spine is the board; it
     * is not a missing neighbour. Present, the badge falls back to the
     * sublabel and reads "swept 2026-09-07 02:26", which is the one thing a
     * reader most needs and the number the last handoff got wrong.
     *
     * The alarm is not lost: the header counts the EDGES, and every
     * unexplained pair is still an absent edge drawn red.
     */
    state: "present",
    count: run.changes.length,
    status: null,
    href: "/settings/ops-data-plumbing",
    props: [
      { key: "Last swept", value: sweptAt.toISOString() },
      { key: "Ran by", value: run.actor_id },
      { key: "Unexplained pairs", value: String(unexplained.length) },
      { key: "Unexplained rows", value: String(unexplainedRows) },
      /*
       * A short key on purpose: the row is a flex of two truncating halves,
       * and against this sentence "Sweep said" rendered as "Swe…".
       */
      { key: "Sweep", value: run.summary },
    ],
    action: null,
    act: sweepAct("Re-run the sweep"),
  })
}

/** The `table.column` behind a node key, or null if this is not a pair node. */
export const pairFromNodeKey = (nodeKey: string): { table: string; column: string } | null => {
  if (!nodeKey.startsWith("pair:")) {
    return null
  }
  const rest = nodeKey.slice("pair:".length)
  const dot = rest.lastIndexOf(".")
  if (dot <= 0 || dot === rest.length - 1) {
    return null
  }
  return { table: rest.slice(0, dot), column: rest.slice(dot + 1) }
}

/** How many offending rows the drawer will list. Evidence, not a data export. */
export const MAX_ITEMS = 50

/**
 * The offending rows behind one pair.
 *
 * 🔴 Every item's `remove` is null, always. The whole lesson of this issue is
 * that most of what a sweep ranks first is correct state; a board that offered
 * "delete this row" beside each piece of evidence would make destroying it the
 * easiest gesture available, one row at a time, with no written reason and no
 * dry run. Repair happens through a named job on the node, or not at all.
 *
 * Queried live rather than replayed from the run, because the run stores the
 * COUNT per pair and not the rows, and because a reader opening the drawer is
 * asking what is true now.
 */
export const danglingPointersItems = async (
  ctx: SpineContext,
  nodeKey: string
): Promise<NodeItem[]> => {
  const pair = pairFromNodeKey(nodeKey)
  if (!pair) {
    return []
  }

  const pg: any = ctx.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  /*
   * Re-derived here rather than trusted from the node key: `table` and
   * `column` reach this function through a URL. Everything interpolated below
   * is checked against the catalog first, so a crafted node key selects
   * nothing instead of naming a table of its own choosing.
   */
  const meta = (
    await pg.raw(
      `select
         (select tt.table_name from information_schema.tables tt
           where tt.table_schema='public' and tt.table_type='BASE TABLE'
             and tt.table_name = ?) as src,
         exists (select 1 from information_schema.columns c
                  where c.table_schema='public' and c.table_name = ? and c.column_name = ?) as has_col,
         exists (select 1 from information_schema.columns c
                  where c.table_schema='public' and c.table_name = ? and c.column_name = 'id') as has_id,
         exists (select 1 from information_schema.columns c
                  where c.table_schema='public' and c.table_name = ? and c.column_name = 'deleted_at') as soft_deletes`,
      [pair.table, pair.table, pair.column, pair.table, pair.table]
    )
  )?.rows?.[0]

  if (!meta?.src || !meta.has_col) {
    return []
  }

  const target = pair.column.replace(/_id$/, "")
  const tgt = (
    await pg.raw(
      `select tt.table_name, exists (select 1 from information_schema.columns c
          where c.table_schema='public' and c.table_name = tt.table_name and c.column_name='deleted_at') as soft_deletes
         from information_schema.tables tt
        where tt.table_schema='public' and tt.table_type='BASE TABLE'
          and tt.table_name in (?, ?, ?)
        order by (tt.table_name = ?) desc
        limit 1`,
      [target, `${target}s`, target.replace(/s$/, ""), target]
    )
  )?.rows?.[0]

  if (!tgt?.table_name) {
    return []
  }

  const srcLive = meta.soft_deletes ? `and s."deleted_at" is null` : ""
  const tgtLive = tgt.soft_deletes ? `and t."deleted_at" is null` : ""
  const idCol = meta.has_id ? `s."id"` : `s."${pair.column}"`

  const rows =
    (
      await pg.raw(
        `select ${idCol} as row_id, s."${pair.column}" as pointer
           from "${pair.table}" s
           left join "${tgt.table_name}" t on t."id" = s."${pair.column}" ${tgtLive}
          where s."${pair.column}" is not null and t."id" is null ${srcLive}
          order by 1
          limit ${MAX_ITEMS}`
      )
    )?.rows ?? []

  return rows.map((r: any) => ({
    id: String(r.row_id),
    label: String(r.pointer),
    /*
     * The pointer VALUE is the label and the row id is the sublabel, not the
     * other way round. What a reader needs first is the string that does not
     * resolve — `cart_e2e_1787467149960` answered in one glance a question the
     * counts took a session to answer.
     */
    sublabel: meta.has_id ? `${pair.table}.id ${r.row_id}` : null,
    status: `${pair.column} → ${tgt.table_name}`,
    href: null,
    props: [],
    remove: null,
  }))
}
