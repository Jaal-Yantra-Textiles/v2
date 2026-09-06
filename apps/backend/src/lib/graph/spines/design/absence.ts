/**
 * The absence rules for the design graph (#1847) — pure, so they can be tested
 * without a container.
 *
 * 🔴 An absent edge is an ASSERTION that a neighbour SHOULD exist. Get one
 * wrong in the permissive direction and the graph cries wolf; get one wrong in
 * the strict direction and it hides the queue it was built to show. Both
 * failures are silent on screen, which is why the rules live here with tests
 * rather than inline in the route.
 */

export type RunLike = {
  id: string
  status?: string | null
  approval_decision?: string | null
  approved_product_id?: string | null
  execution_mode?: string | null
  updated_at?: string | Date | null
  created_at?: string | Date | null
}

/** Design statuses at which downstream work is genuinely expected to exist. */
export const COMMITTED_DESIGN_STATUSES = new Set([
  "Approved",
  "Sample_Production",
  "Commerce_Ready",
])

/** Run statuses that mean the work is done, so its output should exist. */
export const FINISHED_RUN_STATUSES = new Set(["completed"])

/**
 * Runs whose output should be a catalogue product and isn't.
 *
 * A run counts when it is FINISHED or explicitly APPROVED — the two states
 * `approve-run-output` writes `approved_product_id` from. `cancelled` never
 * counts: the work was abandoned, so no product is owed. Deduplicated, because
 * a run can be both finished and approved.
 */
export const runsAwaitingProduct = (runs: RunLike[]): RunLike[] => {
  const seen = new Set<string>()
  const out: RunLike[] = []
  for (const r of runs) {
    if (r.approved_product_id) continue
    const finished = FINISHED_RUN_STATUSES.has(String(r.status))
    const approved = r.approval_decision === "approved"
    if (!finished && !approved) continue
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
  }
  return out
}

/** A design that has been committed to should have at least one run. */
export const expectsProductionRun = (
  designStatus: string | null | undefined,
  runCount: number
): boolean => COMMITTED_DESIGN_STATUSES.has(String(designStatus)) && runCount === 0

/**
 * A run set to outsourced execution has to be done by somebody. In-house runs
 * expect no partner, so an in-house-only design must NOT show a dashed partner
 * edge.
 */
export const expectsPartner = (runs: RunLike[], partnerCount: number): boolean =>
  partnerCount === 0 && runs.some((r) => r.execution_mode === "outsourced")

/** Material cannot be costed against a design whose runs consume nothing. */
export const expectsInventory = (
  runs: RunLike[],
  inventoryCount: number
): boolean => inventoryCount === 0 && runs.length > 0

/** Whole days since the oldest of the given runs last moved. */
export const daysWaiting = (
  runs: RunLike[],
  now: number = Date.now()
): number | null => {
  const stamps = runs
    .map((r) => r.updated_at ?? r.created_at)
    .filter(Boolean)
    .map((d) => new Date(d as string | Date).getTime())
    .filter((t) => Number.isFinite(t))
  if (!stamps.length) return null
  return Math.max(0, Math.floor((now - Math.min(...stamps)) / 86_400_000))
}

/**
 * State for the product node.
 *
 * 🔴 The obvious composition — "if any run produced a product, the edge is
 * present" — is WRONG, and only real data showed it: a design can carry one
 * completed run that was listed and another that never was. Short-circuiting on
 * the first hides exactly the queue this view exists to surface.
 *
 * The absent edge means "finished work with no product", so ANY outstanding run
 * makes it absent, however many siblings succeeded.
 */
export const productNodeState = (
  productCount: number,
  outstandingCount: number,
  linkedProductCount: number = 0
): "present" | "absent" | "derived" | "none" => {
  if (outstandingCount > 0) return "absent"
  if (productCount > 0) return "present"
  // 🔴 A design can be joined to a product through `product_design` without
  // any run ever writing `approved_product_id`. That is a REAL relationship
  // and the graph must not call it nothing — but it is not the run's output
  // either, so it is `derived`: true through a shared record, not through the
  // column this node is about.
  //
  // Order matters. An outstanding run still owes its own product even when the
  // design is linked to some other one, so `absent` is tested first and this
  // can never mask it.
  if (linkedProductCount > 0) return "derived"
  return "none"
}

/**
 * A committed design with no specification cannot produce a tech-pack — the
 * construction panel says as much on screen ("Add at least one so a tech-pack
 * can be generated"). Uncommitted designs owe nothing.
 */
export const expectsSpecification = (
  designStatus: string | null | undefined,
  specificationCount: number
): boolean =>
  COMMITTED_DESIGN_STATUSES.has(String(designStatus)) && specificationCount === 0

/**
 * Work that FINISHED and recorded no material consumption. Distinct from the
 * inventory rule: inventory absent means nothing is linked to cost against,
 * this means something is linked and the actual draw was never written, so the
 * design's real cost is unknowable rather than merely uncomputed.
 *
 * Keyed on finished runs only — a run still in progress has not consumed its
 * material yet, and dashing that edge would cry wolf on every live run.
 */
export const expectsConsumptionLog = (
  runs: RunLike[],
  consumptionLogCount: number
): boolean =>
  consumptionLogCount === 0 &&
  runs.some((r) => FINISHED_RUN_STATUSES.has(String(r.status)))
