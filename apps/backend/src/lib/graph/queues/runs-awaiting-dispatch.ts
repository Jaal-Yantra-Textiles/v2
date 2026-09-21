import { GraphBuilder, asArray } from "../builder"
import type { Graph, GraphNode, NodeItem, SpineContext } from "../types"
import { selectDispatchInput } from "../../../workflows/production-runs/lib/dispatch-selection"
import {
  cleanIds,
  hasUnmet,
  describeUnmet,
  resolveUnmetDependencies,
  INVENTORY_DEPENDENCY_MET_STATUS,
  RUN_DEPENDENCY_MET_STATUS,
} from "../../../workflows/production-runs/lib/run-dependencies"
import { PRODUCTION_POLICY_MODULE } from "../../../modules/production_policy"
import type ProductionPolicyService from "../../../modules/production_policy/service"
import { resolveDispatchDefault } from "../../../modules/production_policy/policy-config"
import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"
import { ORDER_INVENTORY_MODULE } from "../../../modules/inventory_orders"
import type InventoryOrderService from "../../../modules/inventory_orders/service"

/**
 * "Runs awaiting dispatch" — the third COHORT graph (#2202).
 *
 * A run held on its supply is invisible everywhere. Its status is `approved`,
 * exactly like a run that is about to be worked on; its `dispatch_state` is
 * `idle`, exactly like a run nobody has got to yet. Nothing in a list, a
 * filter or the run's own page distinguishes "waiting correctly for cloth
 * that is on its way" from "the cloth arrived and nobody will ever be told to
 * cut it". This board draws that distinction and nothing else.
 *
 * ## The cohort: approved runs that carry a DEPENDENCY
 *
 * 🔴 Not every approved run. On prod 2026-09-20, 8 of 9 approved runs carried
 * no dispatch selection — they are parked deliberately, to be dispatched by
 * hand, and a board that listed all of them would be 8 rows of "fine" hiding
 * the one row that is not. A run with no `depends_on_*` edge is not *awaiting*
 * anything; it is simply parked. The population here is the runs that were
 * told to wait for something.
 *
 * ## Two states, worded differently on purpose
 *
 *   derived — held           a dependency is not yet met. Waiting correctly,
 *                            nothing to do.
 *   absent  — 🔴 cannot      every dependency is met, and nothing anywhere
 *             self-dispatch  says what to dispatch it with. A human must send
 *                            it, and until this board existed nobody knew.
 *
 * ## It asks the dispatch path, it does not restate it
 *
 * Whether a run can dispatch itself is decided in `releaseRunIfReady`, in two
 * steps: `selectDispatchInput` first, then the operator's standing rule via
 * `resolveDispatchDefault` (#2206). Both are imported here. A board that
 * restated either would eventually disagree with the code that actually sends
 * the work — and it would disagree silently, which is the fault this whole
 * feature exists to remove.
 *
 * ⚠️ The policy fallback is the reason the issue's original rule ("no
 * `dispatch_template_ids`") is not enough on its own. Since #2206 a run with
 * no selection at all still dispatches itself if a standing rule matches its
 * `run_type`/`product_type`. Flagging such a run as stuck would be a false
 * alarm on exactly the mechanism built to prevent the real one.
 */

/** Nodes drawn at once. Eighteen, as on the other two boards. */
const CAP = 18

/** Only an approved run is a dispatch candidate; anything else is in flight. */
const RELEASABLE_STATUS = "approved"

export type AwaitingDispatchVerdict =
  /** A dependency is outstanding. Correct, and nothing to do. */
  | { kind: "held"; reason: string }
  /**
   * Everything upstream is met, something says what to send, and it still has
   * not gone. STUCK — see the note on `never_dispatched` below.
   */
  | { kind: "never_dispatched"; via: "selection" | "policy_default" }
  /** Everything upstream is met and nothing says what to send. STUCK. */
  | { kind: "cannot_self_dispatch" }

/**
 * PURE: which of the three a run is in.
 *
 * Takes the already-resolved answers rather than a container, so the rule can
 * be tested without a database and so the two reads it depends on (the
 * dependency sweep and the policy config) happen once for the whole board
 * instead of once per run.
 *
 * 🔴 WHY "ready, and it has templates" IS ALSO A STUCK ROW.
 *
 * The first draft of this board excluded such a run as fine: it has an answer,
 * so when the cloth lands it will dispatch itself. That is wrong whenever the
 * cloth landed FIRST. Release is event-driven — the subscriber fires on the
 * inventory order's delivery — so a dependency attached to a run AFTER its
 * order was already `Delivered` has no event left to wait for. Nothing will
 * ever fire again, and the run sits `approved`/`idle` forever holding a
 * perfectly good set of template ids.
 *
 * Measured on prod 2026-09-21: `prod_run_01M2RV80NQJRKKHJE4S99FQ4QG`
 * (Pashmina Inspired Tunic, stitching, Ksaman) depends on
 * `inv_order_01M232123QP7WD4E7NBSNZWJHM`, delivered 2026-09-17 18:17. The
 * dependency was attached on 2026-09-20 — three days after the only event
 * that could have released it. It carries `dispatch_template_ids` and has
 * dispatched nothing. Excluding it would have made the board report calm over
 * the exact run it was built to find.
 *
 * ⚠️ There is a seconds-wide false positive here: a run whose delivery event
 * is in flight right now reads as never-dispatched until the subscriber
 * finishes. A board a human reads minutes later is the right place to accept
 * that trade; the alternative is a silent hole three days wide.
 */
export const classifyAwaitingDispatch = (input: {
  run: Record<string, unknown>
  unmetReason: string | null
  policyTemplateIds: string[] | null
}): AwaitingDispatchVerdict => {
  if (input.unmetReason) {
    return { kind: "held", reason: input.unmetReason }
  }
  if (selectDispatchInput(input.run as any)) {
    return { kind: "never_dispatched", via: "selection" }
  }
  if (input.policyTemplateIds?.length) {
    return { kind: "never_dispatched", via: "policy_default" }
  }
  return { kind: "cannot_self_dispatch" }
}

/** Every dependency id a run carries, of either kind. */
const dependencyCount = (run: any): number =>
  cleanIds(run?.depends_on_run_ids).length +
  cleanIds(run?.depends_on_inventory_order_ids).length

export const resolveRunsAwaitingDispatch = async (
  ctx: SpineContext
): Promise<Graph> => {
  const { scope } = ctx
  const productionRunService: ProductionRunService = scope.resolve(
    PRODUCTION_RUNS_MODULE
  )

  /*
   * The module service rather than `query.graph`: the dependency columns are
   * jsonb arrays with no containment operator, so the filtering is in memory
   * either way, and this is the same read `findRunsAwaitingInventoryOrder`
   * makes. The set is small by construction — a run leaves it the moment its
   * materials arrive.
   */
  const approved = (await productionRunService
    .listProductionRuns({ status: RELEASABLE_STATUS } as any)
    .catch(() => [])) as any[]

  const candidates = asArray<any>(approved).filter(
    (r) => r?.dispatch_state !== "completed" && dependencyCount(r) > 0
  )

  if (!candidates.length) {
    return emptyGraph(asArray<any>(approved).length)
  }

  /*
   * The standing rules, read ONCE. `resolveDispatchDefault` is pure, so the
   * per-run part is a match against a config already in hand — a board of
   * eighteen runs does not make eighteen policy reads.
   *
   * ⚠️ Never throws: a policy read that fails must leave the board drawable
   * and each run merely unanswered, not take the whole graph down. That is
   * the same promise `resolveDispatchDefaultForRun` makes on the release path.
   */
  let dispatchDefaults: unknown = null
  try {
    const policyService: ProductionPolicyService = scope.resolve(
      PRODUCTION_POLICY_MODULE
    )
    dispatchDefaults = (await policyService.getPolicyConfig())?.dispatch_defaults
  } catch {
    dispatchDefaults = null
  }

  /*
   * The design's `product_type` — one of the two axes a standing rule matches
   * on, and it is NOT on the run. Batched for the whole cohort: the release
   * path reads it per run because it only ever has one.
   */
  const query = scope.resolve("query")
  const designIds = [
    ...new Set(candidates.map((r) => r.design_id).filter(Boolean).map(String)),
  ]
  const productTypeByDesign = new Map<string, string | null>()
  const designNames = new Map<string, string>()
  if (designIds.length) {
    const { data: designRows } = await query
      .graph({
        entity: "designs",
        filters: { id: designIds },
        fields: ["id", "name", "product_type"],
      })
      .catch(() => ({ data: [] }))
    for (const d of asArray<any>(designRows)) {
      productTypeByDesign.set(String(d.id), d.product_type ?? null)
      if (d.name) designNames.set(String(d.id), String(d.name))
    }
  }

  /*
   * The shared dependency predicate, per run, in parallel. Not reimplemented
   * as a batched query: the dispatch guard and the release subscribers both
   * use `resolveUnmetDependencies`, and a board with its own idea of "met"
   * would tell a reader a run is ready that dispatch then refuses.
   */
  const unmetReasons = await Promise.all(
    candidates.map(async (run) => {
      const unmet = await resolveUnmetDependencies(scope, run).catch(() => null)
      /*
       * 🔴 A dependency sweep that THREW is not a met dependency. The release
       * path treats an unreadable dependency as unmet; so does this, and it
       * says so rather than promoting the run into the stuck row on the
       * strength of a database hiccup.
       */
      if (!unmet) return "dependencies could not be read"
      return hasUnmet(unmet) ? describeUnmet(unmet) : null
    })
  )

  const classified = candidates.map((run, i) => ({
    run,
    verdict: classifyAwaitingDispatch({
      run,
      unmetReason: unmetReasons[i],
      policyTemplateIds: resolveDispatchDefault(dispatchDefaults, {
        run_type: run?.run_type ?? null,
        product_type: run?.design_id
          ? productTypeByDesign.get(String(run.design_id)) ?? null
          : null,
      }),
    }),
  }))

  const noAnswer = classified.filter(
    (c) => c.verdict.kind === "cannot_self_dispatch"
  )
  const neverDispatched = classified.filter(
    (c) => c.verdict.kind === "never_dispatched"
  )
  const held = classified.filter((c) => c.verdict.kind === "held")
  const stuck = [...noAnswer, ...neverDispatched]

  /*
   * The stuck rows lead, unconditionally, and within them the ones with no
   * answer lead again: those need a decision, the others need only a click.
   * A board ordered by age would bury both under runs waiting as intended.
   */
  const drawn = [...noAnswer, ...neverDispatched, ...held].slice(0, CAP)

  const builder = new GraphBuilder("queue")

  for (const { run, verdict } of drawn) {
    builder.push(runNode(run, verdict, designNames), {
      label:
        cleanIds(run?.depends_on_inventory_order_ids).length &&
        !cleanIds(run?.depends_on_run_ids).length
          ? "depends_on_inventory_order_ids"
          : cleanIds(run?.depends_on_run_ids).length &&
              !cleanIds(run?.depends_on_inventory_order_ids).length
            ? "depends_on_run_ids"
            : "depends_on_run_ids + depends_on_inventory_order_ids",
      state: verdict.kind === "held" ? "derived" : "absent",
      reason:
        verdict.kind === "held"
          ? verdict.reason
          : verdict.kind === "cannot_self_dispatch"
            ? "every dependency is met and nothing says what to dispatch"
            : "every dependency is met, templates are chosen, and no release event is left to fire",
    })
  }

  return builder.build({
    key: "queue",
    type: "queue",
    label: "Runs awaiting dispatch",
    sublabel: stuck.length
      ? `${stuck.length} ready and going nowhere, ${held.length} held on supply`
      : `${held.length} held on supply, none stuck`,
    state: stuck.length ? "absent" : "present",
    count: classified.length,
    status: null,
    href: null,
    props: [
      { key: "ready, nothing says what to dispatch", value: String(noAnswer.length) },
      { key: "ready, no release event left", value: String(neverDispatched.length) },
      { key: "held on supply", value: String(held.length) },
      /*
       * Named rather than folded into the count above: a run released by a
       * standing rule messages a partner with templates no human picked for
       * it, which is a thing an operator reading this board should be able to
       * see the size of.
       */
      ...(neverDispatched.some((c) => (c.verdict as any).via === "policy_default")
        ? [
            {
              key: "of those, by standing rule",
              value: String(
                neverDispatched.filter(
                  (c) => (c.verdict as any).via === "policy_default"
                ).length
              ),
            },
          ]
        : []),
      ...(classified.length > CAP
        ? [
            {
              key: "shown",
              value: `${CAP} of ${classified.length}, stuck first`,
            },
          ]
        : []),
    ],
    action: null,
  })
}

const runNode = (
  run: any,
  verdict: AwaitingDispatchVerdict,
  designNames: Map<string, string>
): GraphNode => {
  const runId = String(run.id)
  const designName = run.design_id ? designNames.get(String(run.design_id)) : null
  const qty = Number(run.quantity)
  const stuckNode = verdict.kind !== "held"

  /*
   * 🔴 THE DESIGN NAME ALONE IS NOT A LABEL. A design routinely carries
   * several runs — "Pashmina Inspired Tunic" has five on prod, of which more
   * than one can land on this board — and two identically-labelled nodes side
   * by side is a reader picking one at random. The role disambiguates where
   * there is one (`stitching`, `weaving`), and the run's id tail always does.
   */
  const label = [
    designName || "Run",
    run.role ? String(run.role) : null,
    `·${runId.slice(-6)}`,
  ]
    .filter(Boolean)
    .join(" — ")

  return {
    key: `run:${runId}`,
    type:
      verdict.kind === "cannot_self_dispatch"
        ? "run_cannot_self_dispatch"
        : verdict.kind === "never_dispatched"
          ? "run_never_dispatched"
          : "run_held_on_supply",
    label,
    sublabel:
      verdict.kind === "cannot_self_dispatch"
        ? "ready — nothing says what to dispatch"
        : verdict.kind === "never_dispatched"
          ? "ready, templates chosen — no release event left to fire"
          : `waiting on ${verdict.reason}`,
    state: stuckNode ? "absent" : "derived",
    count: 1,
    status: String(run.status ?? "—"),
    href: `/production-runs/${runId}`,
    props: [
      { key: "run", value: runId },
      ...(Number.isFinite(qty) ? [{ key: "quantity", value: String(qty) }] : []),
      { key: "run type", value: String(run.run_type ?? "—") },
      { key: "dispatch state", value: String(run.dispatch_state ?? "—") },
      ...(run.role ? [{ key: "role", value: String(run.role) }] : []),
      ...(run.partner_id
        ? [{ key: "partner", value: String(run.partner_id) }]
        : []),
      ...(verdict.kind === "held"
        ? [{ key: "waiting on", value: verdict.reason }]
        : []),
      /*
       * On a stuck run, say which two answers were looked for, and which was
       * found. "No templates" alone sends the reader to the run page to guess
       * which of the two mechanisms they were supposed to have used.
       */
      ...(verdict.kind === "cannot_self_dispatch"
        ? [
            {
              key: "why stuck",
              value:
                "no dispatch_template_ids/names on the run, and no standing rule matches its run type and product type",
            },
          ]
        : []),
      ...(verdict.kind === "never_dispatched"
        ? [
            {
              key: "why stuck",
              value:
                verdict.via === "policy_default"
                  ? "a standing rule names templates, but the dependency was met before it could fire — nothing will release this run"
                  : "templates are chosen on the run, but the dependency was met before release could fire — nothing will release this run",
            },
            { key: "templates from", value: verdict.via },
          ]
        : []),
    ],
    /*
     * 🔴 An action ONLY on a stuck row. A held run needs nothing done to it,
     * and offering "send to production" beside one would invite an operator to
     * dispatch work whose cloth has not arrived — the exact thing the
     * dependency was added to prevent.
     */
    action: stuckNode
      ? {
          label:
            verdict.kind === "never_dispatched"
              ? "Send to production"
              : "Choose templates and send",
          href: `/production-runs/${runId}`,
        }
      : null,
  }
}

const emptyGraph = (approvedCount: number): Graph =>
  new GraphBuilder("queue").build({
    key: "queue",
    type: "queue",
    label: "Runs awaiting dispatch",
    sublabel: approvedCount
      ? "no approved run is waiting on a dependency"
      : "nothing is approved and undispatched",
    state: "present",
    count: 0,
    status: null,
    href: null,
    props: [
      { key: "approved runs", value: String(approvedCount) },
      { key: "with a dependency", value: "0" },
    ],
    action: null,
  })

/**
 * The dependencies behind one run node — the answer to "waiting on what",
 * which the node's one-line reason can only summarise.
 *
 * Every row carries the dependency's own STATUS beside the status it would
 * need, because that pair is the whole question: `Shipped` looks like progress
 * and is not `Delivered`, and a reader who sees only "waiting" cannot tell a
 * consignment two days out from one that was never placed.
 */
export const runsAwaitingDispatchItems = async (
  ctx: SpineContext,
  nodeKey: string
): Promise<NodeItem[]> => {
  const runId = nodeKey.startsWith("run:") ? nodeKey.slice("run:".length) : null
  if (!runId) return []

  const productionRunService: ProductionRunService = ctx.scope.resolve(
    PRODUCTION_RUNS_MODULE
  )
  const run = await productionRunService
    .retrieveProductionRun(runId)
    .catch(() => null)
  if (!run) return []

  const inventoryOrderIds = cleanIds((run as any).depends_on_inventory_order_ids)
  const runIds = cleanIds((run as any).depends_on_run_ids)

  const items: NodeItem[] = []

  if (inventoryOrderIds.length) {
    const inventoryOrderService: InventoryOrderService = ctx.scope.resolve(
      ORDER_INVENTORY_MODULE
    )
    const orders = await Promise.all(
      inventoryOrderIds.map((id) =>
        inventoryOrderService
          .retrieveInventoryOrder(id, { select: ["id", "status", "expected_delivery_date"] })
          .catch(() => null)
      )
    )
    inventoryOrderIds.forEach((id, i) => {
      const dep = orders[i] as any
      const met = dep && String(dep.status) === INVENTORY_DEPENDENCY_MET_STATUS
      items.push({
        id,
        label: id,
        /*
         * 🔴 A dependency that does not resolve is reported as MISSING, not as
         * unmet. The release path treats both the same way — it refuses — but
         * a reader chasing a delivery needs to know whether the order is late
         * or whether the run names an order that no longer exists.
         */
        sublabel: !dep
          ? "🔴 no such inventory order"
          : met
            ? "delivered"
            : `not yet delivered (${dep.status})`,
        status: dep ? String(dep.status) : null,
        href: `/orders/inventory/${id}`,
        props: [
          { key: "kind", value: "inventory order" },
          { key: "status", value: dep ? String(dep.status) : "missing" },
          { key: "met when", value: INVENTORY_DEPENDENCY_MET_STATUS },
          ...(dep?.expected_delivery_date
            ? [
                {
                  key: "expected",
                  value: String(dep.expected_delivery_date).slice(0, 10),
                },
              ]
            : []),
        ],
        /*
         * 🔴 No removal. Dropping a dependency releases the run to be
         * dispatched against cloth that has not arrived; that is a decision
         * for the run's own route, with its own confirmation, not a row
         * action on a board whose whole purpose is to show the wait.
         */
        remove: null,
      })
    })
  }

  for (const id of runIds) {
    const dep = (await productionRunService
      .retrieveProductionRun(id)
      .catch(() => null)) as any
    const met = dep && String(dep.status) === RUN_DEPENDENCY_MET_STATUS
    items.push({
      id,
      label: id,
      sublabel: !dep
        ? "🔴 no such production run"
        : met
          ? "completed"
          : `not yet completed (${dep.status})`,
      status: dep ? String(dep.status) : null,
      href: `/production-runs/${id}`,
      props: [
        { key: "kind", value: "production run" },
        { key: "status", value: dep ? String(dep.status) : "missing" },
        { key: "met when", value: RUN_DEPENDENCY_MET_STATUS },
      ],
      remove: null,
    })
  }

  return items
}
