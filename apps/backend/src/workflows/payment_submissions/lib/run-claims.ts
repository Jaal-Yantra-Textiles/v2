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

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { runBillableCeiling, isOpenEndedRun } from "./run-billable-ceiling"
import {
  orderPayableCeiling,
  type OrderCharge,
} from "../../../modules/inventory_orders/lib/order-charges"

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
  /**
   * Units billed by this line. A run is no longer claimed as a boolean either
   * (#1596): a partner can finish 1 of 10, bill it, and bill the other 9 later
   * at a different rate. Only attributable when the line names exactly ONE run
   * — a line naming several carries their SUM, and splitting that back out
   * would be an invention.
   */
  quantity?: number | string | null
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
 * What a production run has been claimed for SO FAR.
 *
 * 🔴 A run used to be claimed WHOLLY: it appeared on any live line, therefore
 * it was paid for, therefore refuse. That is what forces reject-and-replace as
 * the only way to correct a claim — `01M0Y336X9A6DJ9ESZ4HC0RXVM` reached
 * "produced 7 of 9" by rejecting the whole prior claim twice (3 → 4 → 7), and
 * it only survived because 4 and 7 happened to be at the same rate.
 *
 * The founder's case (#1596) does not survive it at all: a partner finishes 1
 * of 10, bills it, then bills the remaining 9 at a DIFFERENT price. Under a
 * boolean claim the second bill is refused outright.
 */
export type RunClaimTally = {
  /** Units claimed by live lines that name this run and nothing else. */
  claimed_quantity: number
  /**
   * A live line claims this run WITHOUT an attributable quantity — it names
   * several runs (their quantities are summed into one figure), or it carries
   * no usable quantity at all. Such a claim consumes the run entirely, because
   * splitting it back out would be an invention.
   */
  claimed_wholly: boolean
  /** Every live claim, first writer first, for the refusal message. */
  claims: RunClaim[]
}

/**
 * PURE: fold prior lines into `run id → units claimed so far`.
 *
 * Same skip rule as `foldRunClaims`: a `Rejected` submission never paid
 * anyone, so its lines release their runs.
 */
export function foldRunClaimTallies(
  priorLines: PriorRunLine[]
): Map<string, RunClaimTally> {
  const tallies = new Map<string, RunClaimTally>()

  for (const line of priorLines || []) {
    if (String(line.submission_status || "") === "Rejected") continue

    const runIds = (line.production_run_ids || []).filter(Boolean)
    if (!runIds.length) continue

    const quantity = Number(line.quantity)
    /**
     * Attributable only when the line names exactly ONE run AND states a
     * usable quantity. A line over several runs carries their sum; a line with
     * no quantity states nothing. In both cases the honest reading is "this
     * claimed the run", not a number invented to fill the gap — inventing one
     * here would manufacture headroom to bill against.
     */
    const attributable =
      runIds.length === 1 && Number.isFinite(quantity) && quantity > 0

    for (const runId of runIds) {
      const existing = tallies.get(runId) ?? {
        claimed_quantity: 0,
        claimed_wholly: false,
        claims: [],
      }

      if (attributable) {
        existing.claimed_quantity += quantity
      } else {
        existing.claimed_wholly = true
      }

      existing.claims.push({
        submission_id: line.submission_id,
        submission_status: line.submission_status,
      })
      tallies.set(runId, existing)
    }
  }

  return tallies
}

/**
 * PURE: how many units a REQUEST claims per run.
 *
 * The same attribution rule as the prior-line fold, applied to the incoming
 * lines — one rule, so the two sides of the comparison can never drift:
 *
 *   - a line naming exactly ONE run with a usable quantity claims that many;
 *   - a line naming several runs, or stating no quantity, claims each of its
 *     runs WHOLLY (`null`), because its figure covers all of them together and
 *     splitting it back out would be an invention.
 *
 * 🔑 Only an explicitly stated quantity makes a claim partial. Saying nothing
 * still claims the whole run, which is exactly what every caller meant before
 * this existed — so nothing that used to be refused becomes allowed by
 * accident.
 *
 * `null` is STICKY: once any line claims a run wholly, no later line's number
 * can turn that back into a partial claim.
 */
export function requestedRunQuantities(
  lines: Array<{
    production_run_ids?: string[] | null
    quantity?: number | string | null
  }>
): Map<string, number | null> {
  const requested = new Map<string, number | null>()

  for (const line of lines || []) {
    const runIds = (line?.production_run_ids || []).filter(Boolean).map(String)
    if (!runIds.length) continue

    const quantity = Number(line?.quantity)
    const attributable =
      runIds.length === 1 && Number.isFinite(quantity) && quantity > 0

    for (const runId of runIds) {
      if (!requested.has(runId)) {
        requested.set(runId, attributable ? quantity : null)
        continue
      }

      const existing = requested.get(runId)
      if (existing == null || !attributable) {
        requested.set(runId, null)
        continue
      }

      requested.set(runId, existing + quantity)
    }
  }

  return requested
}

/**
 * What a run may be billed to, plus the figures it was derived from. The
 * `ceiling` is the number every guard must compare against — `quantity` alone
 * stopped being the answer when short-close arrived (#1596).
 */
export type RunCeiling = {
  quantity?: number | string | null
  produced_quantity?: number | string | null
  short_closed_at?: Date | string | null
  ceiling: number | null
}

export type OverclaimedRun = {
  run_id: string
  /** Units the run is worth: its ORDERED quantity. */
  ceiling: number
  claimed_quantity: number
  claimed_wholly: boolean
  /** Units this request asks for, or null when it cannot be attributed. */
  requested: number | null
  /** Who holds the live claims, for the refusal message. */
  claims: RunClaim[]
}

/**
 * PURE: which of these claims would take a run past what it is worth.
 *
 * ⚠️ The ceiling is the run's **ORDERED** quantity, not its produced one. That
 * is deliberate and matches `runPayableAmount`, which multiplies a per-unit
 * rate by `run.quantity`; a produced-quantity ceiling would disagree with the
 * money on day one, and would also refuse the very first partial claim, since
 * `produced_quantity` is captured at completion and is null while the partner
 * is still working. What ordered-quantity headroom does NOT decide is whether
 * the remainder will ever be made — a run short-closed at 7 of 9 keeps 2 units
 * billable until something closes it, which wants its own input rather than an
 * inference here.
 *
 * This is strictly narrower than "refuse any prior claim" in exactly one case:
 * both sides are attributable and their sum fits. Every unattributable claim,
 * every unreadable ceiling, still refuses — an absent number must never read
 * as room to bill.
 *
 * 🔴 #1676 — EVERY claim is bounded, including the first. Until then the
 * ceiling only started applying from the second claim onward: `tallies` holds
 * only runs a PRIOR submission already claimed, so a run's opening claim was
 * compared against nothing and a run ordered for 9 could be billed at 100.
 * The single exception is a run created with NO agreed quantity, which is an
 * explicit, per-run opt-out (`isOpenEndedRun`) rather than the accidental
 * absence of a guard.
 */
export function assessRunClaims(input: {
  /** Units requested per run, or null where the request cannot be attributed. */
  requestedByRun: Map<string, number | null>
  /**
   * The runs' BILLABLE CEILINGS. A caller may pass the raw run rows — the
   * ceiling is re-derived from them when it is absent — but passing a bare
   * `{ quantity }` after a short close would read the ordered figure and
   * ignore the close, so the derivation lives here rather than at each call.
   */
  runs: Map<string, Partial<RunCeiling>>
  tallies: Map<string, RunClaimTally>
}): OverclaimedRun[] {
  const overclaimed: OverclaimedRun[] = []

  for (const [runId, requested] of input.requestedByRun) {
    const tally = input.tallies.get(runId)
    const row = input.runs.get(runId)

    // ⚠️ Derive, never read `row.ceiling` directly: `create` passes RAW run
    // rows whose `ceiling` is undefined, so reading the field would quietly
    // skip every check below on the path that creates most claims.
    const rowCeiling =
      row?.ceiling !== undefined ? row.ceiling : runBillableCeiling(row)

    /**
     * 🔴 The run states NO agreed quantity — it is deliberately open-ended
     * (#1676). There is no ceiling to exceed, so nothing here refuses: not the
     * first claim, not a later one, not even a prior claim that took the run
     * whole. That is the whole point of the opt-out, and it is why it has to be
     * declared by a person at creation rather than inferred from a number.
     *
     * Checked BEFORE the tally, because the alternative reading of "no
     * quantity" — the `!(ceiling > 0)` refusal further down — is the exact
     * inverse of what this means.
     *
     * ⚠️ `&& rowCeiling == null` is load-bearing. SHORT-CLOSING an open-ended
     * run gives it a ceiling after all — the produced figure — because a close
     * is somebody stating outright that no more will be made. Opting out of an
     * agreed quantity is not opting out of that statement, and without this
     * clause a close on such a run would mean nothing at all.
     */
    if (isOpenEndedRun(row) && rowCeiling == null) {
      continue
    }

    if (!tally) {
      /**
       * A FIRST claim. It used to be compared against nothing at all: the
       * tally map only holds runs some PRIOR submission claimed, so a run
       * ordered for 9 could be billed at 100 and this guard would not look
       * (#1676). Only a short-closed run was checked, and only because the
       * close would otherwise have meant nothing.
       *
       * It is now bounded by the same ceiling every later claim is: the agreed
       * quantity, or what was produced once the run is short-closed.
       *
       * ⚠️ This DOES refuse a claim for more than was ordered on a run that
       * genuinely overproduced — `payable-runs` offers the produced figure, so
       * that figure is clamped at the ceiling on the offer side and the two
       * agree. The two honest ways past it are to correct the run's ordered
       * quantity (an audited edit) or to have created the run open-ended. An
       * unbounded first claim by accident, everywhere, is what this replaces.
       */
      const ceiling = rowCeiling

      /**
       * An unattributable claim (a line naming several runs, or stating no
       * quantity) takes the run WHOLE — which is what the run is worth by
       * definition. There is no number to compare, and inventing one is how
       * headroom gets manufactured. Unchanged from before this branch existed.
       */
      if (requested == null) {
        continue
      }

      // No row at all — the run is unknown to this map. Ownership and
      // existence are somebody else's guard; refusing here would block a
      // submit over a run this function was simply not told about.
      if (!row) {
        continue
      }

      if (ceiling == null || !(ceiling > 0)) {
        // A quantity IS set and it is unusable (0, negative, unparseable).
        // That is a broken number, not a declaration of open-endedness, and
        // the second-and-later branch has always refused it.
        overclaimed.push({
          run_id: runId,
          ceiling: 0,
          claimed_quantity: 0,
          claimed_wholly: false,
          requested,
          claims: [],
        })
        continue
      }

      // The same hundredth-of-a-unit tolerance the later claims use.
      if (requested > ceiling + 0.005) {
        overclaimed.push({
          run_id: runId,
          ceiling,
          claimed_quantity: 0,
          claimed_wholly: false,
          requested,
          claims: [],
        })
      }
      continue
    }

    const ceiling = rowCeiling != null && rowCeiling > 0 ? rowCeiling : 0

    const refuse = () =>
      overclaimed.push({
        run_id: runId,
        ceiling,
        claimed_quantity: tally.claimed_quantity,
        claimed_wholly: tally.claimed_wholly,
        requested,
        claims: tally.claims,
      })

    // Somebody already claimed the whole run, or this request claims the whole
    // run, or the run's quantity is set but unusable. No arithmetic is
    // available, so the old whole-run refusal stands. (A run with NO quantity
    // has already been let through above — that is a declaration, not a gap.)
    if (tally.claimed_wholly || requested == null || !(ceiling > 0)) {
      refuse()
      continue
    }

    // A hundredth of a unit of tolerance: quantities are floats, and refusing
    // a legitimate final piece over float dust is worse than allowing it.
    if (tally.claimed_quantity + requested > ceiling + 0.005) {
      refuse()
    }
  }

  return overclaimed
}

/** The refusal, naming the headroom rather than only the refusal. */
export function runsOverclaimedMessage(
  overclaimed: OverclaimedRun[]
): string {
  const detail = overclaimed
    .map(
      ({ run_id, ceiling, claimed_quantity, claimed_wholly, requested, claims }) => {
        const holders =
          claims
            .map(
              (c) =>
                `submission ${c.submission_id ?? "unknown"}${
                  c.submission_status ? `, ${c.submission_status}` : ""
                }`
            )
            .join("; ") || "no prior claim"

        if (claimed_wholly) {
          return `${run_id}: already claimed in full (${holders})`
        }
        if (!(ceiling > 0)) {
          return (
            `${run_id}: already claimed (${holders}), and the run states no` +
            ` quantity to divide`
          )
        }

        const remaining = Math.max(0, ceiling - claimed_quantity)
        const asked = requested == null ? "the whole run" : String(requested)
        return (
          `${run_id}: ordered ${ceiling}, already claimed ${claimed_quantity}` +
          ` (${holders}), ${remaining} remaining — this line asks for ${asked}`
        )
      }
    )
    .join(" | ")

  return `Production runs already paid for: ${detail}`
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
    quantity: item.quantity ?? null,
  }))
}

/**
 * The partner's per-run tallies — the quantity-aware replacement for
 * `listPartnerRunClaims` at every guard that has to answer "how much of this
 * run is still billable" rather than "has it been touched".
 */
/**
 * The ordered quantity of each run, for the claim ceiling.
 *
 * Lives here so every guard reads the ceiling from the same field. The two
 * create-path guards already fetch the runs for other reasons and pass their
 * own map; the submit and update guards do not, and would otherwise each grow
 * their own query.
 *
 * ⚠️ Fetch `quantity` explicitly — a guard reading a field the query never
 * asked for is a guard that always sees `undefined` and always refuses.
 */
export async function listRunOrderedQuantities(
  container: { resolve: (key: string) => any },
  runIds: string[]
): Promise<Map<string, RunCeiling>> {
  const ids = [...new Set((runIds || []).filter(Boolean).map(String))]
  if (!ids.length) return new Map()

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "production_runs",
    /**
     * ⚠️ `produced_quantity` and `short_closed_at` are fetched because
     * `runBillableCeiling` reads them (#1596). A guard reading a field the
     * query never asked for always sees `undefined` — here that would silently
     * ignore every short close and keep offering units nobody will make.
     */
    fields: ["id", "quantity", "produced_quantity", "short_closed_at"],
    filters: { id: ids },
  })

  return new Map(
    ((data || []) as any[]).map((run) => [
      String(run.id),
      {
        quantity: run.quantity,
        produced_quantity: run.produced_quantity,
        short_closed_at: run.short_closed_at,
        ceiling: runBillableCeiling(run),
      },
    ])
  )
}

export async function listPartnerRunTallies(
  service: {
    listPaymentSubmissions: (filters: any, config?: any) => Promise<any[]>
    listPaymentSubmissionItems: (filters: any, config?: any) => Promise<any[]>
  },
  partnerId: string,
  options?: { excludeSubmissionId?: string }
): Promise<Map<string, RunClaimTally>> {
  return foldRunClaimTallies(
    await listPartnerPriorLines(service, partnerId, options)
  )
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
  orders: Map<
    string,
    {
      total_price?: number | string | null
      /**
       * Amounts that are not goods — tax, shipping, a discount (#1737).
       *
       * ⚠️ Must be FETCHED by the caller. A guard reading a field the query
       * never asked for is dead code that types perfectly (#1606).
       *
       * 🔑 Absent or empty leaves the ceiling EXACTLY `total_price`, so every
       * order without charges behaves precisely as it did before this existed.
       * That property is what makes adding a term to a live money guard safe.
       */
      charges?: OrderCharge[] | null
    }
  >
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
    /**
     * 🔴 Goods PLUS the charges that are not goods (#1737). `orderPayableCeiling`
     * is the single owner of that arithmetic — `payable-inventory-orders`
     * offers from the same function, because a screen offering a figure this
     * guard then rejects is the defect `runPayableOffer` was extracted to
     * prevent (#1616).
     */
    const ceiling = orderPayableCeiling(order, order.charges)

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
