/**
 * Who already claimed a production run — scoped by PARTNER, not by design.
 *
 * ## Why this exists
 *
 * Four separate guards answer "is this run already paid for", and every one of
 * them fetched the prior lines the same way:
 *
 *     listPaymentSubmissionItems({ design_id: designIds }, …)
 *
 * — `create-payment-submission` step 6, `submit-payment-submission`,
 * `update-payment-submission-item`, and both `payable-runs` routes.
 *
 * The justification was written down in step 6 and was true when it was
 * written: *"a run belongs to exactly one design, so a prior billing of it can
 * only live on a line for that design."*
 *
 * 🔴 That stops being true the moment a line can be sourced from something
 * other than a design. A run-sourced line carries `design_id: null` — it is
 * keyed by the runs it pays for — so a `design_id`-scoped query CANNOT SEE IT.
 * A design-sourced claim of a run that a run-sourced line already paid for
 * would find no prior, and bill it a second time. The guard would not fire, log,
 * or fail; it would simply be looking somewhere the claim isn't.
 *
 * This is the same shape as every other absence-read-as-permission bug in this
 * module (#1557, #1565): the query returned nothing, and nothing was taken to
 * mean nobody.
 *
 * ## Why partner scope is the right replacement
 *
 * A run belongs to exactly one PARTNER — `production_run.partner_id`, the field
 * the ownership guard already checks — and a submission is for exactly one
 * partner. So a prior billing of a run can only live on a line of a submission
 * for that run's partner. That is just as exact as the design claim was, just
 * as bounded (one partner's submissions, not the whole table), and it holds no
 * matter what a line is sourced FROM.
 *
 * 🔑 Scope by the thing the run actually belongs to, not by the thing the line
 * happens to be keyed on today.
 */

export type PriorRunLine = {
  submission_id: string | null
  submission_status: string | null
  production_run_ids: string[] | null
  inventory_order_id?: string | null
  /**
   * What this line claimed. Needed because an inventory order is no longer
   * claimed as a boolean — a real payout arrives in tranches, so the guard has
   * to compare a SUM against what the order is worth (#1617).
   */
  amount?: number | string | null
}

export type RunClaim = {
  /** The submission holding the live claim. */
  submission_id: string | null
  submission_status: string | null
}

/**
 * What an inventory order has been claimed for SO FAR, across every live
 * submission — plus who holds those claims.
 */
export type InventoryOrderClaim = {
  /** Sum of the live lines naming this order. */
  claimed_total: number
  /** Every live claim, earliest first, for the refusal message. */
  claims: RunClaim[]
}

/**
 * PURE: fold prior lines into `run id → the claim on it`.
 *
 * A `Rejected` submission never paid anyone, so its lines release their runs
 * and it is skipped — the same rule the design-scoped guards already applied.
 *
 * ⚠️ Unlike the runless guard, `Draft` is NOT exempt here. That exemption
 * exists so a partner can hand-submit the auto-draft they were given, which is
 * a claim naming NO runs. A claim that names a run a Draft already holds is a
 * different thing, and the run-level guard has always refused it.
 *
 * First writer wins, so the reported submission is the earliest live claim
 * rather than an arbitrary one.
 */
export function foldRunClaims(
  priorLines: PriorRunLine[]
): Map<string, RunClaim> {
  const claims = new Map<string, RunClaim>()

  for (const line of priorLines || []) {
    if (String(line.submission_status || "") === "Rejected") continue

    for (const runId of line.production_run_ids || []) {
      if (!runId || claims.has(runId)) continue
      claims.set(runId, {
        submission_id: line.submission_id,
        submission_status: line.submission_status,
      })
    }
  }

  return claims
}

/**
 * PURE: the same fold for INVENTORY ORDERS — but a SUM, not a flag.
 *
 * 🔴 This used to key on `inventory_order_id` alone: the order appeared on a
 * live submission, therefore it was paid for, therefore refuse. That guard was
 * right about the hole it closed — a new source column with no double-pay guard
 * is a double-pay hole by construction — but it assumed one order ⇒ one payout.
 *
 * Real payouts arrive in TRANCHES. `inv_order_01K76V5J4KKS3EC71D2R2MNJSP` was
 * agreed at ₹35,000, of which ₹30,000 was released on 2026-08-28. Recording the
 * ₹30,000 — the only honest thing to record, because it is what left the bank —
 * made the remaining ₹5,000 unbillable, and the only ways out were to overstate
 * the payout or to reject a payment that really happened (#1617).
 *
 * So: fold to `order id → claimed so far`, and let the caller compare that sum
 * against what the order is worth. A `Rejected` submission never paid anyone,
 * so its lines release their claim, exactly as before.
 */
export function foldInventoryOrderClaims(
  priorLines: PriorRunLine[]
): Map<string, InventoryOrderClaim> {
  const claims = new Map<string, InventoryOrderClaim>()

  for (const line of priorLines || []) {
    if (String(line.submission_status || "") === "Rejected") continue

    const orderId = line.inventory_order_id
    if (!orderId) continue

    const existing = claims.get(orderId) ?? { claimed_total: 0, claims: [] }
    /**
     * A line with no amount contributes NOTHING to the total rather than
     * defaulting to something. Guessing here would either invent headroom that
     * does not exist or consume headroom that does.
     */
    const amount = Number(line.amount ?? 0)
    existing.claimed_total += Number.isFinite(amount) ? amount : 0
    existing.claims.push({
      submission_id: line.submission_id,
      submission_status: line.submission_status,
    })
    claims.set(orderId, existing)
  }

  return claims
}

/**
 * PURE: what is still billable on an order.
 *
 * `ceiling` is the AGREED total where one is recorded, falling back to the
 * order's ordered `total_price`. The two are not the same number and must not
 * be conflated: the order above was ordered at ₹63,375.75 and agreed at
 * ₹35,000, so a guard using the ordered total would have allowed ₹28,375 more
 * than anyone agreed to pay.
 */
export function inventoryOrderHeadroom(
  claim: InventoryOrderClaim | undefined,
  ceiling: number
): number {
  const claimed = claim?.claimed_total ?? 0
  return Math.max(0, ceiling - claimed)
}

/**
 * Every prior submission line belonging to one partner, in the shape
 * `foldRunClaims` wants.
 *
 * Two queries rather than one because the partner lives on the SUBMISSION and
 * the runs live on the ITEM: resolve the partner's submissions first, then the
 * lines under them. An `excludeSubmissionId` drops the submission being edited,
 * so a line does not read its own claim as a conflict with itself.
 */
/**
 * The partner's prior submission lines, RAW.
 *
 * Callers that need more than the claim maps — `payable-runs` reads
 * `run_provenance`, `design_id`, `amount` and `quantity` off these rows —
 * take them from here rather than re-deriving the partner scope themselves.
 */
export async function listPartnerSubmissionItems(
  service: {
    listPaymentSubmissions: (filters: any, config?: any) => Promise<any[]>
    listPaymentSubmissionItems: (filters: any, config?: any) => Promise<any[]>
  },
  partnerId: string,
  options?: { excludeSubmissionId?: string }
): Promise<any[]> {
  if (!partnerId) return []

  const submissions = await service.listPaymentSubmissions({
    partner_id: partnerId,
  })

  const submissionIds = (submissions || [])
    .map((s: any) => s?.id)
    .filter(
      (id: string) => !!id && id !== options?.excludeSubmissionId
    )

  if (!submissionIds.length) return []

  return (await service.listPaymentSubmissionItems(
    { submission_id: submissionIds },
    { relations: ["submission"] }
  )) as any[]
}

export async function listPartnerPriorLines(
  service: {
    listPaymentSubmissions: (filters: any, config?: any) => Promise<any[]>
    listPaymentSubmissionItems: (filters: any, config?: any) => Promise<any[]>
  },
  partnerId: string,
  options?: { excludeSubmissionId?: string }
): Promise<PriorRunLine[]> {
  const items = await listPartnerSubmissionItems(service, partnerId, options)

  return ((items || []) as any[]).map((item) => ({
    submission_id: item.submission?.id ?? item.submission_id ?? null,
    submission_status: item.submission?.status ?? null,
    production_run_ids: (item.production_run_ids || []) as string[],
    inventory_order_id: item.inventory_order_id ?? null,
    amount: item.amount ?? null,
  }))
}

export async function listPartnerRunClaims(
  service: {
    listPaymentSubmissions: (filters: any, config?: any) => Promise<any[]>
    listPaymentSubmissionItems: (filters: any, config?: any) => Promise<any[]>
  },
  partnerId: string,
  options?: { excludeSubmissionId?: string }
): Promise<Map<string, RunClaim>> {
  return foldRunClaims(
    await listPartnerPriorLines(service, partnerId, options)
  )
}

/**
 * Both claim maps from ONE pass over the partner's lines.
 *
 * Prefer this wherever a caller needs to check runs and inventory orders
 * together — `listPartnerRunClaims` and a separate inventory lookup would walk
 * the same rows twice.
 */
export async function listPartnerClaims(
  service: {
    listPaymentSubmissions: (filters: any, config?: any) => Promise<any[]>
    listPaymentSubmissionItems: (filters: any, config?: any) => Promise<any[]>
  },
  partnerId: string,
  options?: { excludeSubmissionId?: string }
): Promise<{
  runs: Map<string, RunClaim>
  inventoryOrders: Map<string, InventoryOrderClaim>
}> {
  const lines = await listPartnerPriorLines(service, partnerId, options)

  return {
    runs: foldRunClaims(lines),
    inventoryOrders: foldInventoryOrderClaims(lines),
  }
}

/** The refusal, naming who holds each claimed thing. */
const claimedList = (
  duplicates: string[],
  claims: Map<string, RunClaim>
): string =>
  duplicates
    .map((id) => {
      const claim = claims.get(id)
      const status = claim?.submission_status
        ? `, ${claim.submission_status}`
        : ""
      return `${id} (submission ${claim?.submission_id ?? "unknown"}${status})`
    })
    .join(", ")

export function runsAlreadyClaimedMessage(
  duplicates: string[],
  claims: Map<string, RunClaim>
): string {
  return `Production runs already paid for: ${claimedList(duplicates, claims)}`
}

export type OverclaimedInventoryOrder = {
  order_id: string
  /** What the order is worth: the agreed total, else the ordered total. */
  ceiling: number
  claimed_total: number
  requested: number
}

/**
 * PURE: which of these lines would take an order past what it is worth.
 *
 * Extracted from the workflow step so the money decision is testable without
 * standing up a submission — inventory-order-sourced payouts have no
 * integration coverage at all, so logic left inline in the step would ship
 * unexercised.
 *
 * ⚠️ `total_price` is a `bigNumber` column: through `query.graph` it arrives as
 * a number, but through a raw service read it can be a STRING. Coerced here,
 * once, rather than at each call site.
 */
export function assessInventoryOrderClaims(input: {
  /** Requested amount per order, already summed across this submission. */
  requestedByOrder: Map<string, number>
  orders: Map<string, { total_price?: number | string | null }>
  claims: Map<string, InventoryOrderClaim>
}): OverclaimedInventoryOrder[] {
  const overclaimed: OverclaimedInventoryOrder[] = []

  for (const [orderId, requested] of input.requestedByOrder) {
    const order = input.orders.get(orderId)
    if (!order) continue

    /**
     * The ceiling is the ORDERED total.
     *
     * A separate `agreed_total` column was built and then removed: the price
     * agreed can sit below the ordered total (₹35,000 against ₹63,375.75 on the
     * order that opened #1617), but with no surface to record it the column
     * would have been null on every row forever — a typed field with no writer,
     * which reads as a contract and means nothing. If that deviation needs
     * capturing, add the column WITH its input, so it is never a façade.
     *
     * Never the receipts value: on that same order it derives ₹64,274, which is
     * ABOVE the ordered total — so an amountless line, which defaults to the
     * receipts figure, is refused here rather than silently overpaying.
     */
    const ordered = Number(order.total_price ?? 0)
    const ceiling = Number.isFinite(ordered) ? ordered : 0

    // A ceiling of zero means the order is worth nothing we can read. Refusing
    // on that would block every payout on an unpriced order; the whole-order
    // guard this replaces did not block those either.
    if (!(ceiling > 0)) continue

    const claimedTotal = input.claims.get(orderId)?.claimed_total ?? 0

    // Half a paisa of tolerance: amounts are rounded to 2dp upstream, and
    // refusing a legitimate final tranche over float noise is worse than
    // allowing a rounding error.
    if (claimedTotal + requested > ceiling + 0.005) {
      overclaimed.push({
        order_id: orderId,
        ceiling,
        claimed_total: claimedTotal,
        requested,
      })
    }
  }

  return overclaimed
}

export function inventoryOrdersAlreadyClaimedMessage(
  overclaimed: OverclaimedInventoryOrder[],
  claims: Map<string, InventoryOrderClaim>
): string {
  /**
   * Names the headroom, not just the refusal. "Already paid for" told the
   * caller to give up; what they actually need to know is how much of the
   * order is still billable and who holds the rest.
   */
  const detail = overclaimed
    .map(({ order_id, ceiling, claimed_total, requested }) => {
      const holders = (claims.get(order_id)?.claims ?? [])
        .map(
          (c) =>
            `submission ${c.submission_id ?? "unknown"}${
              c.submission_status ? `, ${c.submission_status}` : ""
            }`
        )
        .join("; ")
      const remaining = Math.max(0, ceiling - claimed_total)
      return (
        `${order_id}: worth ${ceiling}, already claimed ${claimed_total}` +
        ` (${holders || "no prior claim"}), ${remaining} remaining` +
        ` — this line asks for ${requested}`
      )
    })
    .join(" | ")

  return `Inventory order payout exceeds what the order is worth: ${detail}`
}
