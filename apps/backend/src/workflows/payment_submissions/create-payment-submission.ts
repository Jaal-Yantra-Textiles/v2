import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import type { IEventBusModuleService } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../modules/payment_submissions"
import {
  designsBilledWithoutRunEvidence,
  runlessResubmitMessage,
} from "./lib/run-evidence-guard"
import {
  listPartnerRunClaims,
  runsAlreadyClaimedMessage,
} from "./lib/run-claims"
import {
  inventoryOrdersAlreadyClaimedMessage,
  listPartnerClaims,
} from "./lib/run-claims"
import {
  normaliseCurrency,
  resolveSubmissionCurrency,
} from "./lib/submission-currency"
import { resolveRunLineAmount } from "./lib/run-line-amount"
import {
  describeInventoryOrderValue,
  valueInventoryOrderByReceipts,
} from "./lib/inventory-order-value"
import {
  resolveRunLinePrice,
  runPayableAmount,
  type RunForPayout,
} from "../production-runs/lib/run-payable"
import { PARTNER_MODULE } from "../../modules/partner"
import { DESIGN_MODULE } from "../../modules/designs"
import { TASKS_MODULE } from "../../modules/tasks"
import designPartnersLink from "../../links/design-partners-link"
import submissionDesignsLink from "../../links/submission-designs-link"
import submissionTasksLink from "../../links/submission-tasks-link"
import partnerTaskLink from "../../links/partner-task"
import PaymentSubmissionsService from "../../modules/payment_submissions/service"

export type CreatePaymentSubmissionInput = {
  partner_id: string
  design_ids: string[]
  task_ids?: string[]
  notes?: string
  documents?: Array<{ id?: string; url: string; filename?: string; mimeType?: string }>
  /**
   * ⚠️ Free-form, and NOT where the money lives any more.
   *
   * The four fields below used to reach this workflow only through here, and
   * every route validates `metadata` as `z.record(z.string(), z.any())` — which
   * accepts anything. `design_quantities` and `design_quantites` both validated
   * cleanly, and the typo fell through to "absent means 1" and billed a
   * per-unit rate once (#1554 by spelling mistake, #1557).
   *
   * Reading them off `metadata` is kept ONLY as a fallback for callers that
   * still post that way; the typed fields win outright. See `moneyOf` below.
   */
  metadata?: Record<string, any>
  /**
   * What the caller is asking to be paid, as typed inputs rather than blob keys.
   *
   * 🔑 These are the contract now. Each corresponds to a `metadata.design_*`
   * key the workflow used to read, and an explicit field REPLACES the whole
   * corresponding map rather than merging key-by-key — a caller that sends
   * `quantities` must not still be overridden by a stale blob it never wrote.
   */
  /** Units billed per design. Absent means 1. */
  quantities?: Record<string, number>
  /** Agreed rate per unit, per design. Beats the design's stored cost. */
  unit_amounts?: Record<string, number>
  /** Typed line TOTAL per design. Wins outright; never multiplied by quantity. */
  cost_overrides?: Record<string, number>
  /** Typed line total per task. */
  task_cost_overrides?: Record<string, number>
  /**
   * The status the submission lands in. "Pending" (the default) is a partner
   * saying "pay me for this". "Draft" is the system pre-filling one FOR the
   * partner — see `require_design_status` — which they then review and submit.
   */
  status?: "Draft" | "Pending"
  /**
   * Whether the design's own status must be Approved / Commerce_Ready.
   *
   * Default true: a partner submitting by hand is asserting the design work is
   * finished, and the design status is the check on that assertion.
   *
   * The run-completion auto-draft passes false, because there the proof of
   * finished work is the COMPLETED PRODUCTION RUN itself — and completion sets
   * the design to Technical_Review, so a status check would reject every single
   * auto-draft. Only the auto path may set this; the partner-facing route never
   * does.
   */
  require_design_status?: boolean
  /**
   * Which completed production runs each design line pays for, keyed by design
   * id. Optional — a hand-picked design line has no run behind it and stays
   * exactly as it is today.
   *
   * 🔴 A typed input, never `metadata`. This is what stops the same finished
   * run being paid for twice, and a guard that reads an untyped blob is one
   * spelling mistake away from reading nothing at all (#1557).
   */
  production_run_ids?: Record<string, string[]>
  /**
   * What the payout is denominated in. Absent means the partner's own
   * `currency_code`, and `inr` if they have none — see
   * `lib/submission-currency`, which owns that precedence.
   *
   * ⚠️ This is the currency of the SUBMISSION, not of its sources. A line
   * priced in another currency is converted into this one at an FX rate that
   * is recorded on the line, never applied silently.
   */
  currency?: string
  /**
   * Payout lines sourced from production RUNS directly (#1612).
   *
   * Each entry becomes ONE line claiming the runs it names. Grouping is the
   * caller's: the seven runs behind retail order #79 are one payout of ₹8,974,
   * not seven of ₹1,282, because that is how the money actually moved.
   *
   * 🔑 This is the only expression available for a run with `design_id: null`
   * — a run minted from `order.fulfillment_created` is not design-backed and
   * never will be.
   */
  run_lines?: Array<{
    run_ids: string[]
    /** An explicit line TOTAL. Usually required — see `lib/run-line-amount`. */
    amount?: number
    quantity?: number
    /** The commissioning retail order, denormalised onto the line (#1598). */
    order_id?: string
    /** What the line is called on a payout a partner reads. */
    label?: string
    /** The currency `amount` is stated in, if not the submission's. */
    currency?: string
  }>
  /**
   * Payout lines sourced from INVENTORY ORDERS — material we bought.
   *
   * The amount is DERIVED from what was actually received unless overridden:
   * a `Partial` order's `total_price` is what was ordered, not what is owed.
   * See `lib/inventory-order-value`.
   */
  inventory_order_lines?: Array<{
    inventory_order_id: string
    amount?: number
    currency?: string
  }>
}

type ValidatedDesign = {
  id: string
  name: string
  /** What this line bills IN TOTAL. Always `unit_amount * quantity` when both are set. */
  estimated_cost: number
  /** Units billed. 1 unless the caller said otherwise — see `design_quantities`. */
  quantity: number
  /**
   * The per-unit rate the total was built from, or null when the total was
   * typed directly (a cost override) and there is no recorded rate to show.
   */
  unit_amount: number | null
  cost_breakdown: Record<string, unknown> | null
  /** The completed run ids this line pays for, or null when it came from none. */
  production_run_ids: string[] | null
}

type ValidatedTask = {
  id: string
  title: string
  amount: number
  cost_breakdown: Record<string, unknown> | null
}

type DesignGraphResult = {
  id: string
  name: string
  status: string
  estimated_cost: number | null
  cost_breakdown: Record<string, unknown> | null
}

type TaskGraphResult = {
  id: string
  title: string
  status: string
  estimated_cost: number | null
  actual_cost: number | null
  cost_currency: string | null
  cost_type: string | null
}

type ProductionRunGraphResult = {
  id: string
  design_id: string | null
  partner_id: string | null
  status: string | null
}

type DesignPartnerLinkResult = {
  design_id: string
  partner_id: string
}

type PartnerTaskLinkResult = {
  partner_id: string
  task_id: string
}

type SubmissionDesignLinkResult = {
  design_id: string
  payment_submission?: { status: string } | null
}

type SubmissionTaskLinkResult = {
  task_id: string
  payment_submission?: { status: string } | null
}

// Partner-entered amounts from the submission form (metadata.design_cost_overrides /
// metadata.task_cost_overrides). A positive override satisfies the cost requirement
// and becomes the submitted amount even when the design/task has no stored cost.
const sanitizeCostOverrides = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  if (raw && typeof raw === "object") {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const amount = Number(value)
      if (Number.isFinite(amount) && amount > 0) {
        out[id] = amount
      }
    }
  }
  return out
}

/**
 * Units billed per design (`metadata.design_quantities`).
 *
 * 🔴 Why this exists: `design.estimated_cost` / `production_cost` are PER
 * FINISHED UNIT — `workflows/designs/estimate-design-cost.ts` divides a run
 * total back to per-unit precisely because that is what the column means. This
 * workflow used that per-unit figure as the entire line amount, so a design
 * costed at 850/unit and produced nine times billed 850. (#1554)
 *
 * ⚠️ Absent means **1**, never "derive it". Defaulting to a derived quantity
 * would silently re-price every existing caller, and over-paying a partner is
 * harder to undo than under-paying them: the caller that knows the run says how
 * many, and one that does not gets exactly today's behaviour.
 *
 * A non-positive or non-finite value is dropped rather than clamped — the same
 * rule the cost overrides use, so "0" cannot quietly zero a line.
 */
export const sanitizeQuantities = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  if (raw && typeof raw === "object") {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const qty = Number(value)
      if (Number.isFinite(qty) && qty > 0) {
        out[id] = qty
      }
    }
  }
  return out
}

/**
 * PURE: what one design-sourced line bills, and how it got there.
 *
 * Precedence, and the reason for it:
 *
 *  - **An override wins outright.** It is a TOTAL somebody typed — the partner
 *    on the submission form, or the run-completion auto-draft passing
 *    `runPayableAmount`'s already-multiplied figure. Multiplying it again is
 *    the #456 defect (850/unit → stored 7650 → shown 7650 x 9 = 68850).
 *    `unit_amount` is left null: there is no recorded rate behind a typed
 *    total, and dividing the total by the quantity would invent one.
 *  - **Otherwise the design's per-unit cost times the quantity.** With no
 *    quantity supplied this is `cost x 1`, which is byte-for-byte today's
 *    behaviour — this function cannot change an existing caller's amount.
 *
 * Rounded to two decimals: money, not float dust. Mirrors `runPayableAmount`.
 */
export const resolveDesignLineAmount = (input: {
  unit_cost: number
  quantity?: number | null
  override?: number | null
  unit_override?: number | null
}): { amount: number; quantity: number; unit_amount: number | null } => {
  const qty =
    Number.isFinite(Number(input.quantity)) && Number(input.quantity) > 0
      ? Number(input.quantity)
      : 1

  const override = Number(input.override)
  if (Number.isFinite(override) && override > 0) {
    return { amount: override, quantity: qty, unit_amount: null }
  }

  // A rate the caller knows better than the design does — the run-completion
  // auto-draft passing what the partner actually typed at completion, which
  // may differ from the design's stored estimate and is the agreed price.
  const unitOverride = Number(input.unit_override)
  if (Number.isFinite(unitOverride) && unitOverride > 0) {
    return {
      amount: Math.round(unitOverride * qty * 100) / 100,
      quantity: qty,
      unit_amount: unitOverride,
    }
  }

  const unit = Number(input.unit_cost)
  if (!Number.isFinite(unit) || unit <= 0) {
    return { amount: 0, quantity: qty, unit_amount: null }
  }

  return {
    amount: Math.round(unit * qty * 100) / 100,
    quantity: qty,
    unit_amount: unit,
  }
}

/**
 * PURE: what one payout line bills, given the RUNS it names as well as the
 * design behind it.
 *
 * 🔴 `resolveDesignLineAmount` alone was the #1616 defect. `payable-runs`
 * offered ₹810 for the Princess Highway run; creating the submission for that
 * exact run — naming it in `production_run_ids`, so there was no ambiguity —
 * wrote ₹1,056.40, the DESIGN's `estimated_cost`. +30%, and nothing surfaced
 * the difference: the create response returns `items: []`, so the amount was
 * invisible until the submission was fetched again. Two pricers over one run,
 * and the figure an operator reads was not the figure that got written.
 *
 * Precedence, and the reason for each step:
 *
 *  1. **A typed total wins outright.** Somebody typed it — the partner on the
 *     form, or the auto-draft passing `runPayableAmount`'s already-multiplied
 *     figure. Multiplying it again is #456.
 *  2. **A typed rate next**, for the same reason: a human who knows the agreed
 *     price outranks every stored estimate.
 *  3. **Then the RUNS**, via `runPayableOffer` — the same helper `payable-runs`
 *     offers from, so the screen and this path cannot disagree.
 *  4. **Then the design's per-unit cost**, which is where a hand-picked design
 *     line with no run behind it has always been priced.
 *
 * ⚠️ Step 4 still catches a claimed run carrying NO agreed rate. Refusing there
 * would block the documented flow of billing a run whose price was agreed
 * off-system; `payable-runs` flags such a run `payable: false` and shows the
 * design's figure as a suggestion, which is the same treatment.
 *
 * An explicit `quantity` combined with runs bills the RUNS' rate for that many
 * units: the caller is correcting how many, not what each one costs.
 */
export const resolvePaymentLineAmount = (input: {
  runs?: Array<RunForPayout & { produced_quantity?: number | null }> | null
  unit_cost: number
  quantity?: number | null
  override?: number | null
  unit_override?: number | null
}): { amount: number; quantity: number; unit_amount: number | null } => {
  const runPrice = input.runs?.length ? resolveRunLinePrice(input.runs) : null

  const explicitQty =
    Number.isFinite(Number(input.quantity)) && Number(input.quantity) > 0
      ? Number(input.quantity)
      : null

  const override = Number(input.override)
  const unitOverride = Number(input.unit_override)
  const hasOverride = Number.isFinite(override) && override > 0
  const hasUnitOverride = Number.isFinite(unitOverride) && unitOverride > 0

  /**
   * The runs answer only when nobody typed a price. Their own quantity is used
   * unless the caller supplied one — and when the runs carry DIFFERENT rates
   * there is no single rate to record, so the total stands alone with a null
   * `unit_amount` rather than an invented average.
   */
  if (runPrice && !hasOverride && !hasUnitOverride) {
    if (runPrice.unit_amount == null) {
      /**
       * ⚠️ The supplied quantity is recorded but NOT multiplied — there is no
       * rate to multiply by. The runs' summed total stands, which is the only
       * figure that is actually agreed. Zeroing the line here because the
       * arithmetic is unavailable would put a 0 in front of a partner.
       */
      return {
        amount: runPrice.amount,
        quantity: explicitQty ?? runPrice.quantity,
        unit_amount: null,
      }
    }

    return resolveDesignLineAmount({
      unit_cost: runPrice.unit_amount,
      quantity: explicitQty ?? runPrice.quantity,
    })
  }

  return resolveDesignLineAmount({
    unit_cost: input.unit_cost,
    quantity: explicitQty ?? runPrice?.quantity,
    override: input.override,
    unit_override: input.unit_override,
  })
}

// Step 1a: Validate all designs for submission eligibility
const validateDesignsForSubmissionStep = createStep(
  "validate-designs-for-submission",
  async (
    input: {
      partner_id: string
      design_ids: string[]
      cost_overrides?: Record<string, number>
      /** Units billed per design. Absent means 1 — see `sanitizeQuantities`. */
      quantities?: Record<string, number>
      /** Per-unit rate per design, when the caller knows it better than the design does. */
      unit_amounts?: Record<string, number>
      require_design_status?: boolean
      /** Draft submissions also block a second Draft — see below. */
      status?: "Draft" | "Pending"
      /** design id → the completed run ids that line pays for. */
      production_run_ids?: Record<string, string[]>
    },
    { container }
  ) => {
    if (!input.design_ids?.length) {
      return new StepResponse<ValidatedDesign[]>([])
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    // 1. Fetch all designs
    const { data: designs } = await query.graph({
      entity: "designs",
      fields: ["id", "name", "status", "estimated_cost", "production_cost", "cost_breakdown"],
      filters: { id: input.design_ids },
    })

    const typedDesigns = designs as unknown as DesignGraphResult[]

    if (!typedDesigns || typedDesigns.length !== input.design_ids.length) {
      const found = new Set((typedDesigns || []).map((d) => d.id))
      const missing = input.design_ids.filter((id) => !found.has(id))
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Designs not found: ${missing.join(", ")}`
      )
    }

    // 2. Validate status — must be Commerce_Ready or Approved.
    // Skipped for the run-completion auto-draft, whose proof of finished work
    // is the completed run rather than the design's status.
    const ELIGIBLE_STATUSES = ["Commerce_Ready", "Approved"]
    /**
     * The statuses a verified completed run may stand in for.
     *
     * An ALLOWLIST, not a denylist, on purpose: a design status added later
     * lands OUTSIDE it and gets a loud 400 an admin can waive with
     * `require_design_status: false`, rather than silently becoming payable.
     *
     * `Conceptual` is deliberately absent. A design that never left the concept
     * stage cannot legitimately have a completed production run, so a claim
     * naming one is data drift, not a payout — and drift that pays out silently
     * is drift nobody ever fixes. There is exactly one such row on prod, against
     * 8 `Superseded`, which are ordinary and stay payable: a design revised
     * AFTER the partner finished producing it is still owed for. The admin
     * waiver remains for the case where the odd run turns out to be real.
     */
    const RUN_BACKED_ELIGIBLE_STATUSES = [
      "In_Development",
      "Technical_Review",
      "Sample_Production",
      "Revision",
      "Approved",
      "Rejected",
      "On_Hold",
      "Commerce_Ready",
      "Superseded",
    ]
    /**
     * A design whose line states the completed run it pays for is exempt.
     *
     * 🔴 Without this the partner runs screen (#1571 B half) could not submit
     * anything at all. `complete-production-run` sets the design to
     * Technical_Review, so the design a partner has just finished producing is
     * NEVER Approved/Commerce_Ready at the moment they bill for it — the gate
     * rejected precisely the claims it should wave through.
     *
     * This is the same reasoning the auto-draft already relies on, applied to
     * the partner's own claim: the proof of finished work is the COMPLETED RUN,
     * which is strictly stronger evidence than a status field. And it cannot be
     * forged — the run block below verifies every claimed run exists, is
     * `completed`, belongs to THIS partner, and is a run of THIS design,
     * throwing otherwise. A design named here without a run that survives those
     * checks never reaches the end of this step.
     *
     * ⚠️ Deliberately NOT the same as accepting `require_design_status: false`
     * from a partner. That would let a caller waive the gate on ANY design by
     * asking, which is why the partner validator refuses the field. This waives
     * it only where a verified run replaces it, per design; a design with no
     * claimed run is checked exactly as before.
     */
    const runBackedDesignIds = new Set(
      Object.entries(input.production_run_ids || {})
        .filter(([, runIds]) => (runIds || []).length > 0)
        .map(([designId]) => designId)
    )
    if (input.require_design_status !== false) {
      const ineligible = typedDesigns.filter(
        (d) =>
          !ELIGIBLE_STATUSES.includes(d.status) &&
          !(
            runBackedDesignIds.has(d.id) &&
            RUN_BACKED_ELIGIBLE_STATUSES.includes(d.status)
          )
      )
      if (ineligible.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Designs not eligible for payment (status must be Approved or Commerce_Ready): ${ineligible.map((d) => `${d.name || d.id} (${d.status})`).join(", ")}`
        )
      }
    }

    // 3. Validate all designs have a USABLE cost (estimated_cost,
    // production_cost, a partner-entered total override, or a caller-supplied
    // per-unit rate).
    //
    // 🔴 "Usable" means POSITIVE, not merely "not null". The guard used to ask
    // `=== null || === undefined`, so a stored **0** sailed through it — and
    // `resolveDesignLineAmount` then returns amount 0, creating a payment line
    // that bills nothing while looking like a real claim.
    //
    // That is not hypothetical. `POST /admin/designs/:id/recalculate-cost`
    // writes `total_estimated: 0` with `confidence: "estimated"` when the
    // estimator finds no BOM and no inventory history — it reports "I found
    // nothing" as "this costs nothing". Running it over nine designs on prod
    // turned four of them from null into 0, which is how this was found. A
    // design with no cost data must be REFUSED, exactly as it was before
    // somebody pressed recalculate.
    const overrides = input.cost_overrides || {}
    const suppliedUnitAmounts = input.unit_amounts || {}
    const isUsableCost = (value: unknown): boolean => {
      const n = Number(value)
      return Number.isFinite(n) && n > 0
    }
    const noCost = typedDesigns.filter(
      (d) =>
        !overrides[d.id] &&
        !suppliedUnitAmounts[d.id] &&
        !isUsableCost(d.estimated_cost) &&
        !isUsableCost((d as any).production_cost)
    )
    if (noCost.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Designs missing cost: ${noCost.map((d) => d.name || d.id).join(", ")}`
      )
    }

    // 4. Validate designs belong to the requesting partner
    const { data: linkResults } = await query.graph({
      entity: designPartnersLink.entryPoint,
      fields: ["design_id", "partner_id"],
      filters: {
        design_id: input.design_ids,
        partner_id: input.partner_id,
      },
    })

    const typedLinkResults = linkResults as unknown as DesignPartnerLinkResult[]
    const linkedDesignIds = new Set(
      (typedLinkResults || []).map((r) => r.design_id)
    )
    const notOwned = input.design_ids.filter((id) => !linkedDesignIds.has(id))
    if (notOwned.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Designs not assigned to this partner: ${notOwned.join(", ")}`
      )
    }

    // 5. Check no design is already in a Pending or Under_Review submission
    const { data: existingLinks } = await query.graph({
      entity: submissionDesignsLink.entryPoint,
      fields: ["design_id", "payment_submission.*"],
      filters: { design_id: input.design_ids },
    })

    // A Draft counts as blocking when we're about to create ANOTHER Draft:
    // the run-completion auto-draft fires per completion, and without this a
    // design completed twice (a redo, a re-dispatch) would accumulate duplicate
    // drafts. A partner submitting by hand is NOT blocked by their own draft —
    // that's them turning the draft into a real submission.
    const typedExistingLinks = existingLinks as unknown as SubmissionDesignLinkResult[]
    const blockingStatuses = new Set(["Pending", "Under_Review"])
    if (input.status === "Draft") {
      blockingStatuses.add("Draft")
    }
    const activeSubmissionDesigns = (typedExistingLinks || []).filter((link) => {
      const status = link.payment_submission?.status
      return !!status && blockingStatuses.has(status)
    })

    if (activeSubmissionDesigns.length) {
      const ids = [
        ...new Set(activeSubmissionDesigns.map((l) => l.design_id)),
      ]
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Designs already in an active payment submission: ${ids.join(", ")}`
      )
    }

    /**
     * 6. The runs a line claims to be paying for must actually be that
     *    partner's, that design's, finished — and not already paid for.
     *
     * 🔴 This is the guard the design-level check in step 5 cannot be. That
     * one asks "is this design in an OPEN submission", which stops being true
     * the moment the submission is Approved or Paid. A design is produced many
     * times, so once the first payout closes, the very same completed run can
     * be submitted again and the second claim looks identical to the first.
     * Nothing in the record could tell them apart, because nothing recorded
     * which run was paid for.
     *
     * Scoped to items of the SAME designs rather than every item ever written:
     * a run belongs to exactly one design, so a prior billing of it can only
     * live on a line for that design. Exact, and bounded by the request.
     */
    const claimedRuns = input.production_run_ids || {}
    const allClaimedRunIds = [
      ...new Set(Object.values(claimedRuns).flat().filter(Boolean)),
    ]

    /**
     * The claimed runs, kept in scope so the LINE CAN BE PRICED FROM THEM
     * below (#1616). Empty when nothing was claimed.
     */
    const runById = new Map<string, any>()

    if (allClaimedRunIds.length) {
      const { data: runs } = await query.graph({
        entity: "production_runs",
        fields: [
          "id",
          "design_id",
          "partner_id",
          "status",
          /**
           * ⚠️ The money fields are FETCHED, not merely typed. `runPayableOffer`
           * reads all four, and a pricer reading a field the query never asked
           * for silently prices everything at zero.
           */
          "quantity",
          "produced_quantity",
          "partner_cost_estimate",
          "cost_type",
        ],
        filters: { id: allClaimedRunIds },
      })
      const typedRuns = (runs || []) as unknown as ProductionRunGraphResult[]
      for (const run of typedRuns) {
        runById.set(run.id, run)
      }

      const missing = allClaimedRunIds.filter((id) => !runById.has(id))
      if (missing.length) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Production runs not found: ${missing.join(", ")}`
        )
      }

      for (const [designId, runIds] of Object.entries(claimedRuns)) {
        if (!input.design_ids.includes(designId)) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `production_run_ids names design ${designId}, which is not in design_ids`
          )
        }
        for (const runId of runIds) {
          const run = runById.get(runId)!
          if (String(run.design_id || "") !== designId) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              `Production run ${runId} is not a run of design ${designId}`
            )
          }
          if (String(run.partner_id || "") !== input.partner_id) {
            throw new MedusaError(
              MedusaError.Types.NOT_ALLOWED,
              `Production run ${runId} does not belong to this partner`
            )
          }
          if (String(run.status || "") !== "completed") {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              `Production run ${runId} is not completed (${run.status})`
            )
          }
        }
      }

      /**
       * Already paid for? A Rejected submission never paid anyone, so its
       * lines release their runs; everything else — Draft, Pending,
       * Under_Review, Approved, Paid — is a live claim on that run.
       *
       * 🔴 Scoped by PARTNER, not by design. This used to fetch priors with
       * `{ design_id: input.design_ids }`, on the reasoning that a run belongs
       * to one design so a prior billing of it could only sit on a line for
       * that design. A line sourced from anything other than a design carries
       * `design_id: null`, so that query could not see it, and the same run
       * could be billed once from each side with neither claim visible to the
       * other. See `lib/run-claims`.
       */
      const submissionService: PaymentSubmissionsService = container.resolve(
        PAYMENT_SUBMISSIONS_MODULE
      )
      const billed = await listPartnerRunClaims(
        submissionService as any,
        input.partner_id
      )
      const duplicates = allClaimedRunIds.filter((id) => billed.has(id))
      if (duplicates.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          runsAlreadyClaimedMessage(duplicates, billed)
        )
      }
    }

    /**
     * 7. The same question for a claim that names NO runs (#1556).
     *
     * 🔴 Step 6 is exact, and it is gated on `allClaimedRunIds.length` — it
     * only runs when the new submission names runs. A submission that names
     * none skips it entirely, and step 5 has already stopped being true once
     * the first payout is Approved or Paid. So a design could be billed, paid,
     * and billed again with no run ids, and NOTHING would object. The two
     * claims are indistinguishable afterwards because the second recorded no
     * evidence of what it was for.
     *
     * There is no arithmetic that rescues this: a claim naming nothing cannot
     * be diffed against what was already paid. The model already takes the
     * honest position — a line whose provenance is not `recorded` reads as
     * UNKNOWN, never as clear — and paying twice is far harder to undo than a
     * refusal a partner can act on in one step. The create screen has sent
     * `production_run_ids` since #1579, so "name the runs" is a field away.
     */
    if (input.design_ids?.length) {
      const submissionService: PaymentSubmissionsService = container.resolve(
        PAYMENT_SUBMISSIONS_MODULE
      )
      const priorItems = (await submissionService.listPaymentSubmissionItems(
        { design_id: input.design_ids },
        { relations: ["submission"] }
      )) as any[]

      const conflicts = designsBilledWithoutRunEvidence({
        design_ids: input.design_ids,
        claimed_runs: input.production_run_ids,
        prior_lines: (priorItems || []).map((item) => ({
          design_id: item.design_id ? String(item.design_id) : null,
          submission_status: item.submission?.status ?? null,
          submission_id: item.submission?.id ?? item.submission_id ?? null,
          run_provenance: item.run_provenance ?? null,
        })),
      })

      if (conflicts.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          runlessResubmitMessage(conflicts)
        )
      }
    }

    const quantities = input.quantities || {}
    const unitAmounts = input.unit_amounts || {}

    const validated: ValidatedDesign[] = typedDesigns.map((d) => {
      const line = resolvePaymentLineAmount({
        runs: (claimedRuns[d.id] || [])
          .map((runId) => runById.get(runId))
          .filter(Boolean),
        // `estimated_cost` / `production_cost` are PER FINISHED UNIT. Treating
        // either as a line total is the #1554 defect (#1554).
        unit_cost: Number(d.estimated_cost || (d as any).production_cost || 0),
        quantity: quantities[d.id],
        override: overrides[d.id],
        unit_override: unitAmounts[d.id],
      })

      return {
        id: d.id,
        name: d.name,
        estimated_cost: line.amount,
        quantity: line.quantity,
        unit_amount: line.unit_amount,
        cost_breakdown: d.cost_breakdown,
        production_run_ids: claimedRuns[d.id]?.length
          ? [...new Set(claimedRuns[d.id])]
          : null,
      }
    })

    return new StepResponse(validated)
  }
)

// Step 1b: Validate all tasks for submission eligibility
const validateTasksForSubmissionStep = createStep(
  "validate-tasks-for-submission",
  async (
    input: {
      partner_id: string
      task_ids: string[]
      cost_overrides?: Record<string, number>
    },
    { container }
  ) => {
    if (!input.task_ids?.length) {
      return new StepResponse<ValidatedTask[]>([])
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    // 1. Fetch all tasks
    const { data: tasks } = await query.graph({
      entity: "task",
      fields: [
        "id",
        "title",
        "status",
        "estimated_cost",
        "actual_cost",
        "cost_currency",
        "cost_type",
      ],
      filters: { id: input.task_ids },
    })

    const typedTasks = tasks as unknown as TaskGraphResult[]

    if (!typedTasks || typedTasks.length !== input.task_ids.length) {
      const found = new Set((typedTasks || []).map((t) => t.id))
      const missing = input.task_ids.filter((id) => !found.has(id))
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Tasks not found: ${missing.join(", ")}`
      )
    }

    // 2. Only completed tasks can be submitted for payment
    const ELIGIBLE_STATUSES = ["completed"]
    const ineligible = typedTasks.filter(
      (t) => !ELIGIBLE_STATUSES.includes(t.status)
    )
    if (ineligible.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Tasks not eligible for payment (status must be completed): ${ineligible.map((t) => `${t.title || t.id} (${t.status})`).join(", ")}`
      )
    }

    // 3. Every task must have a cost (prefer actual_cost, fall back to
    // estimated_cost, or a partner-entered override)
    const overrides = input.cost_overrides || {}
    const noCost = typedTasks.filter(
      (t) =>
        !overrides[t.id] &&
        (t.actual_cost === null || t.actual_cost === undefined) &&
        (t.estimated_cost === null || t.estimated_cost === undefined)
    )
    if (noCost.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Tasks missing cost: ${noCost.map((t) => t.title || t.id).join(", ")}`
      )
    }

    // 4. Tasks must belong to the requesting partner
    const { data: partnerTasks } = await query.graph({
      entity: partnerTaskLink.entryPoint,
      fields: ["partner_id", "task_id"],
      filters: {
        partner_id: input.partner_id,
        task_id: input.task_ids,
      },
    })
    const typedPartnerTasks = partnerTasks as unknown as PartnerTaskLinkResult[]
    const linkedTaskIds = new Set(
      (typedPartnerTasks || []).map((r) => r.task_id)
    )
    const notOwned = input.task_ids.filter((id) => !linkedTaskIds.has(id))
    if (notOwned.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Tasks not assigned to this partner: ${notOwned.join(", ")}`
      )
    }

    // 5. No task can already be in an active submission
    const { data: existingLinks } = await query.graph({
      entity: submissionTasksLink.entryPoint,
      fields: ["task_id", "payment_submission.*"],
      filters: { task_id: input.task_ids },
    })

    const typedExistingLinks = existingLinks as unknown as SubmissionTaskLinkResult[]
    const activeSubmissionTasks = (typedExistingLinks || []).filter((link) => {
      const status = link.payment_submission?.status
      return status === "Pending" || status === "Under_Review"
    })
    if (activeSubmissionTasks.length) {
      const ids = [
        ...new Set(activeSubmissionTasks.map((l) => l.task_id)),
      ]
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Tasks already in an active payment submission: ${ids.join(", ")}`
      )
    }

    const validated: ValidatedTask[] = typedTasks.map((t) => ({
      id: t.id,
      title: t.title,
      amount: overrides[t.id] ?? Number(t.actual_cost ?? t.estimated_cost ?? 0),
      cost_breakdown: {
        cost_currency: t.cost_currency,
        cost_type: t.cost_type,
        estimated_cost: t.estimated_cost,
        actual_cost: t.actual_cost,
        ...(overrides[t.id] != null ? { override_amount: overrides[t.id] } : {}),
      },
    }))

    return new StepResponse(validated)
  }
)

// Step 2: Create the submission record with items (designs and/or tasks)
export type ValidatedRunLine = {
  run_ids: string[]
  label: string
  amount: number
  quantity: number
  unit_amount: number | null
  order_id: string | null
  cost_breakdown: Record<string, unknown>
}

export type ValidatedInventoryLine = {
  inventory_order_id: string
  inventory_order_name: string
  amount: number
  quantity: number
  cost_breakdown: Record<string, unknown>
}

/**
 * Run-sourced lines: the runs must be this partner's, completed, and not
 * already claimed.
 *
 * The ownership checks mirror the design path's step 6 exactly, minus the
 * "belongs to this design" check, which is meaningless here — these runs have
 * no design. What replaces it is the `order_id` cross-check below: if a caller
 * names a commissioning order, every run on the line must actually belong to
 * it, or the line's provenance is decoration.
 */
const validateRunLinesStep = createStep(
  "validate-run-lines-for-submission",
  async (
    input: {
      partner_id: string
      run_lines: NonNullable<CreatePaymentSubmissionInput["run_lines"]>
    },
    { container }
  ) => {
    const lines = input.run_lines || []
    if (!lines.length) return new StepResponse<ValidatedRunLine[]>([])

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const allRunIds = [
      ...new Set(lines.flatMap((line) => line.run_ids || []).filter(Boolean)),
    ]
    if (!allRunIds.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A run-sourced line must name at least one production run."
      )
    }

    const { data: runs } = await query.graph({
      entity: "production_runs",
      fields: [
        "id",
        "partner_id",
        "status",
        "quantity",
        "produced_quantity",
        "partner_cost_estimate",
        "cost_type",
        "order_id",
      ],
      filters: { id: allRunIds },
    })
    const runById = new Map(
      ((runs || []) as any[]).map((run) => [String(run.id), run])
    )

    const missing = allRunIds.filter((id) => !runById.has(id))
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production runs not found: ${missing.join(", ")}`
      )
    }

    for (const runId of allRunIds) {
      const run = runById.get(runId)!
      if (String(run.partner_id || "") !== input.partner_id) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Production run ${runId} does not belong to this partner`
        )
      }
      if (String(run.status || "") !== "completed") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Production run ${runId} is not completed (${run.status})`
        )
      }
    }

    /**
     * 🔴 The double-pay guard, partner-scoped. A run-sourced line and a
     * design-sourced line can name the same run, and only a partner-scoped
     * lookup sees both — see `lib/run-claims`.
     */
    const submissionService: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    const billed = await listPartnerRunClaims(
      submissionService as any,
      input.partner_id
    )
    const duplicates = allRunIds.filter((id) => billed.has(id))
    if (duplicates.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        runsAlreadyClaimedMessage(duplicates, billed)
      )
    }

    // A run may be claimed only once ACROSS the lines of this submission too —
    // two lines naming the same run would each pass the prior-claim check above
    // and bill it twice in a single request.
    const seen = new Set<string>()
    for (const line of lines) {
      for (const runId of line.run_ids || []) {
        if (seen.has(runId)) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Production run ${runId} is claimed by more than one line of this submission`
          )
        }
        seen.add(runId)
      }
    }

    const validated: ValidatedRunLine[] = lines.map((line) => {
      const lineRuns = (line.run_ids || []).map((id) => runById.get(id)!)

      if (line.order_id) {
        const foreign = lineRuns.filter(
          (run) => String(run.order_id || "") !== String(line.order_id)
        )
        if (foreign.length) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Runs ${foreign.map((r) => r.id).join(", ")} do not belong to order ${line.order_id}`
          )
        }
      }

      let resolved
      try {
        resolved = resolveRunLineAmount({
          runs: lineRuns,
          amount: line.amount,
          quantity: line.quantity,
          deriveAmount: (run) => runPayableAmount(run as any),
        })
      } catch (e: any) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, e.message)
      }

      return {
        run_ids: line.run_ids,
        label:
          line.label ||
          (line.order_id
            ? `Production for order ${line.order_id}`
            : `Production runs (${line.run_ids.length})`),
        amount: resolved.amount,
        quantity: resolved.quantity,
        unit_amount: resolved.unit_amount,
        order_id: line.order_id ?? null,
        cost_breakdown: resolved.cost_breakdown,
      }
    })

    return new StepResponse(validated)
  }
)

/**
 * Inventory-order lines: the order must be this partner's, have receipts, and
 * not already be claimed.
 *
 * ⚠️ The amount is derived from the TYPED `line_fulfillments` rows, never from
 * `total_price` (what was ordered) and never from
 * `metadata.partner_delivery_history` (which disagrees with the typed rows —
 * #1613). See `lib/inventory-order-value`.
 */
const validateInventoryOrderLinesStep = createStep(
  "validate-inventory-order-lines-for-submission",
  async (
    input: {
      partner_id: string
      inventory_order_lines: NonNullable<
        CreatePaymentSubmissionInput["inventory_order_lines"]
      >
    },
    { container }
  ) => {
    const lines = input.inventory_order_lines || []
    if (!lines.length) return new StepResponse<ValidatedInventoryLine[]>([])

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const orderIds = [
      ...new Set(lines.map((l) => l.inventory_order_id).filter(Boolean)),
    ]

    if (orderIds.length !== lines.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "An inventory order may appear only once per submission — an order is claimed whole."
      )
    }

    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "id",
        "status",
        "total_price",
        "currency_code",
        "partner.id",
        "orderlines.id",
        "orderlines.quantity",
        "orderlines.price",
        "orderlines.material_name",
        "orderlines.line_fulfillments.quantity_delta",
      ],
      filters: { id: orderIds },
    })
    const orderById = new Map(
      ((orders || []) as any[]).map((order) => [String(order.id), order])
    )

    const missing = orderIds.filter((id) => !orderById.has(id))
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory orders not found: ${missing.join(", ")}`
      )
    }

    const submissionService: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    const { inventoryOrders: claimed } = await listPartnerClaims(
      submissionService as any,
      input.partner_id
    )
    const duplicates = orderIds.filter((id) => claimed.has(id))
    if (duplicates.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        inventoryOrdersAlreadyClaimedMessage(duplicates, claimed)
      )
    }

    const validated: ValidatedInventoryLine[] = lines.map((line) => {
      const order = orderById.get(line.inventory_order_id)!

      const ownerId = order.partner?.id ?? order.partner?.[0]?.id ?? null
      if (ownerId && String(ownerId) !== input.partner_id) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Inventory order ${line.inventory_order_id} does not belong to this partner`
        )
      }

      const value = valueInventoryOrderByReceipts(order.orderlines || [])

      const amount =
        line.amount != null && Number.isFinite(Number(line.amount))
          ? Math.round(Number(line.amount) * 100) / 100
          : value.total

      if (!(amount > 0)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Inventory order ${line.inventory_order_id} has no recorded receipts to bill ` +
            `(status ${order.status}). Nothing has been delivered against it, so a payout ` +
            `would be for nothing — record the delivery first, or send an explicit amount.`
        )
      }

      return {
        inventory_order_id: line.inventory_order_id,
        inventory_order_name: `Inventory order ${line.inventory_order_id}`,
        amount,
        quantity: value.received_quantity || 1,
        cost_breakdown: {
          source: "inventory_order",
          basis:
            line.amount != null ? "explicit_total" : "received_x_unit_price",
          ordered_total: Number(order.total_price ?? 0),
          received_quantity: value.received_quantity,
          lines: value.lines,
          breakdown: describeInventoryOrderValue(value),
        },
      }
    })

    return new StepResponse(validated)
  }
)

/**
 * Decide what the payout is denominated in, once, before anything is priced.
 *
 * A step rather than a `transform` because it has to READ the partner, and the
 * precedence (explicit → partner's own → inr) belongs in one place — see
 * `lib/submission-currency`. Scattering it across callers is how two routes
 * come to disagree about what currency a partner is paid in.
 *
 * ⚠️ A partner whose `currency_code` is NULL is real (hrhandloom's is), so the
 * lookup failing to produce one is an expected path, not an error.
 */
const resolveSubmissionCurrencyStep = createStep(
  "resolve-submission-currency",
  async (
    input: { partner_id: string; currency?: string },
    { container }
  ) => {
    if (normaliseCurrency(input.currency)) {
      return new StepResponse(normaliseCurrency(input.currency))
    }

    let partnerCurrency: string | null = null
    try {
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "partner",
        fields: ["id", "currency_code"],
        filters: { id: input.partner_id },
      })
      partnerCurrency = (data || [])[0]?.currency_code ?? null
    } catch {
      // A partner we cannot read is not a reason to refuse the payout; it just
      // means we fall through to the default below.
      partnerCurrency = null
    }

    return new StepResponse(
      resolveSubmissionCurrency({
        explicit: input.currency,
        partnerCurrency,
      })
    )
  }
)

const createSubmissionRecordStep = createStep(
  "create-submission-record",
  async (
    input: {
      partner_id: string
      designs: ValidatedDesign[]
      tasks: ValidatedTask[]
      notes?: string
      documents?: Array<{ id?: string; url: string; filename?: string; mimeType?: string }>
      metadata?: Record<string, any>
      status?: "Draft" | "Pending"
      /**
       * What the payout is denominated in. Resolved by the workflow (explicit
       * → partner's own → inr) rather than defaulted here, so there is exactly
       * one place that decides it. See `lib/submission-currency`.
       */
      currency?: string
      runLines?: ValidatedRunLine[]
      inventoryLines?: ValidatedInventoryLine[]
    },
    { container }
  ) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    const designTotal = input.designs.reduce(
      (sum, d) => sum + d.estimated_cost,
      0
    )
    const taskTotal = input.tasks.reduce((sum, t) => sum + t.amount, 0)
    const runTotal = (input.runLines || []).reduce((sum, l) => sum + l.amount, 0)
    const inventoryTotal = (input.inventoryLines || []).reduce(
      (sum, l) => sum + l.amount,
      0
    )
    const total_amount =
      Math.round(
        (designTotal + taskTotal + runTotal + inventoryTotal) * 100
      ) / 100

    if (
      input.designs.length +
        input.tasks.length +
        (input.runLines || []).length +
        (input.inventoryLines || []).length ===
      0
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "At least one design, task, production run or inventory order is required"
      )
    }

    // documents is typed as json() (Record<string, unknown>) in the model
    // but we store an array of document objects — cast at the service boundary
    // A Draft has not been submitted, so it carries no `submitted_at` — the
    // partner stamps that when they submit it.
    const status = input.status === "Draft" ? "Draft" : "Pending"

    const submission = await service.createPaymentSubmissions({
      partner_id: input.partner_id,
      status,
      total_amount,
      /**
       * 🔴 Was hardcoded `"inr"`. Every submission ever written was INR, so
       * nothing had exercised the alternative — but the retail payout for
       * order #79 is derived in USD and settled in rupees, and partners exist
       * whose own `currency_code` is NULL. Resolved upstream so a caller
       * stating a currency is not silently overridden by a default.
       */
      currency: normaliseCurrency(input.currency) || "inr",
      submitted_at: status === "Draft" ? null : new Date(),
      notes: input.notes || null,
      documents: (input.documents || null) as Record<string, unknown> | null,
      metadata: input.metadata || null,
    })

    // Design-sourced line items
    for (const design of input.designs) {
      await service.createPaymentSubmissionItems({
        source_type: "design",
        design_id: design.id,
        design_name: design.name,
        task_id: null,
        task_name: null,
        amount: design.estimated_cost,
        // What the total is made of, so a partner disputing a payment reads
        // "9 x 850" rather than a bare number. `unit_amount` is null when the
        // total was typed rather than derived — see resolveDesignLineAmount.
        quantity: design.quantity,
        unit_amount: design.unit_amount,
        cost_breakdown: design.cost_breakdown || null,
        // Which finished runs this line paid for — the record that lets the
        // NEXT submission refuse to pay for them again.
        //
        // Cast at the service boundary the same way `documents` is: the column
        // is `model.json()`, which types as an object, and what we store is an
        // ARRAY of run ids (a design line can pay for several runs at once).
        production_run_ids: (design.production_run_ids ?? null) as unknown as
          | Record<string, unknown>
          | null,
        /**
         * Stated, never inferred later. A design line with no runs named is
         * `not_recorded` rather than `no_run`: the caller picked a DESIGN, and
         * a design is produced many times, so we have not been told there is
         * no run behind this money — only that nobody said which. #1565
         */
        run_provenance: design.production_run_ids?.length
          ? "recorded"
          : "not_recorded",
        submission_id: submission.id,
      })
    }

    // Task-sourced line items
    for (const task of input.tasks) {
      await service.createPaymentSubmissionItems({
        source_type: "task",
        design_id: null,
        design_name: null,
        task_id: task.id,
        task_name: task.title,
        amount: task.amount,
        // A task is billed as one piece of work, not per unit. Stated rather
        // than left to the column default so the row is unambiguous.
        quantity: 1,
        unit_amount: null,
        // A task is not production output; there is no run behind it. This is
        // the one case where a missing run is an ANSWER rather than a gap, so
        // it is the one case that may be read as "nothing billed here". #1565
        production_run_ids: null as unknown as Record<string, unknown> | null,
        run_provenance: "no_run" as const,
        cost_breakdown: task.cost_breakdown || null,
        submission_id: submission.id,
      })
    }

    /**
     * Run-sourced line items (#1612).
     *
     * `run_provenance` is `recorded` unconditionally: a run line exists BECAUSE
     * it names runs, and the validation step refuses one that does not. There
     * is no path here that leaves the provenance unknown.
     */
    for (const line of input.runLines || []) {
      await service.createPaymentSubmissionItems({
        source_type: "run",
        design_id: null,
        design_name: line.label,
        task_id: null,
        task_name: null,
        inventory_order_id: null,
        inventory_order_name: null,
        order_id: line.order_id,
        amount: line.amount,
        quantity: line.quantity,
        unit_amount: line.unit_amount,
        cost_breakdown: line.cost_breakdown || null,
        production_run_ids: line.run_ids as unknown as Record<
          string,
          unknown
        > | null,
        run_provenance: "recorded" as const,
        submission_id: submission.id,
      })
    }

    /**
     * Inventory-order line items (#1612).
     *
     * `no_run` because material we bought is not production output — there was
     * never a run behind it. This is the same case a task line is in: a missing
     * run here is an ANSWER, not a gap, and may safely be read as "no run
     * billed" (#1565).
     */
    for (const line of input.inventoryLines || []) {
      await service.createPaymentSubmissionItems({
        source_type: "inventory_order",
        design_id: null,
        design_name: null,
        task_id: null,
        task_name: null,
        inventory_order_id: line.inventory_order_id,
        inventory_order_name: line.inventory_order_name,
        order_id: null,
        amount: line.amount,
        quantity: line.quantity,
        unit_amount: null,
        cost_breakdown: line.cost_breakdown || null,
        production_run_ids: null as unknown as Record<string, unknown> | null,
        run_provenance: "no_run" as const,
        submission_id: submission.id,
      })
    }

    /**
     * 🔴 The lines are read back and returned WITH the submission (#1616).
     *
     * `create` returned a submission with `items: []`, so the amount it had
     * just written was invisible until someone fetched the submission again.
     * That is how a ₹1,056.40 line went out against an offered ₹810 and was
     * caught only because a handoff happened to name the expected figure. An
     * amount that cannot be seen at the moment it is written cannot be checked
     * at the moment it is written.
     *
     * Best-effort: the submission and its lines are already committed by the
     * time this runs, and a failure to read them back must not roll back a
     * created payout.
     */
    try {
      ;(submission as any).items = await service.listPaymentSubmissionItems({
        submission_id: submission.id,
      })
    } catch {
      // Leave whatever the create returned; the submission itself is written.
    }

    return new StepResponse(submission, submission.id)
  },
  async (submissionId: string, { container }) => {
    if (!submissionId) return
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    await service.softDeletePaymentSubmissions(submissionId)
  }
)

// Step 3: Link submission to partner
const linkSubmissionToPartnerStep = createStep(
  "link-submission-to-partner",
  async (
    input: { submission_id: string; partner_id: string },
    { container }
  ) => {
    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link

    const link: LinkDefinition = {
      [PARTNER_MODULE]: { partner_id: input.partner_id },
      [PAYMENT_SUBMISSIONS_MODULE]: {
        payment_submission_id: input.submission_id,
      },
    }

    await remoteLink.create([link])
    return new StepResponse(link, link)
  },
  async (rollbackLink: LinkDefinition, { container }) => {
    if (!rollbackLink) return
    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link
    await remoteLink.dismiss([rollbackLink])
  }
)

// Step 4: Link submission to each design
const linkSubmissionToDesignsStep = createStep(
  "link-submission-to-designs",
  async (
    input: { submission_id: string; design_ids: string[] },
    { container }
  ) => {
    if (!input.design_ids?.length) {
      return new StepResponse<LinkDefinition[]>([], [])
    }

    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link

    const links: LinkDefinition[] = input.design_ids.map((design_id) => ({
      [PAYMENT_SUBMISSIONS_MODULE]: {
        payment_submission_id: input.submission_id,
      },
      [DESIGN_MODULE]: { design_id },
    }))

    await remoteLink.create(links)
    return new StepResponse(links, links)
  },
  async (rollbackLinks: LinkDefinition[], { container }) => {
    if (!rollbackLinks?.length) return
    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link
    await remoteLink.dismiss(rollbackLinks)
  }
)

// Step 5: Link submission to each task
const linkSubmissionToTasksStep = createStep(
  "link-submission-to-tasks",
  async (
    input: { submission_id: string; task_ids: string[] },
    { container }
  ) => {
    if (!input.task_ids?.length) {
      return new StepResponse<LinkDefinition[]>([], [])
    }

    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link

    const links: LinkDefinition[] = input.task_ids.map((task_id) => ({
      [PAYMENT_SUBMISSIONS_MODULE]: {
        payment_submission_id: input.submission_id,
      },
      [TASKS_MODULE]: { task_id },
    }))

    await remoteLink.create(links)
    return new StepResponse(links, links)
  },
  async (rollbackLinks: LinkDefinition[], { container }) => {
    if (!rollbackLinks?.length) return
    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link
    await remoteLink.dismiss(rollbackLinks)
  }
)

// Fire-and-forget event so subscribers (including the WhatsApp visual
// flow seeded by seed-partner-payment-status-flow.ts) can react. Done
// as the LAST step so a rollback in any earlier step skips the event.
// Event name follows the production-run convention so the wildcard
// trigger pattern `payment_submission.*` covers all status events.
const emitSubmissionCreatedStep = createStep(
  "emit-payment-submission-created",
  async (
    input: {
      submission_id: string
      partner_id: string
      total_amount: number | null
      currency: string | null
      status?: "Draft" | "Pending"
    },
    { container },
  ) => {
    const eventService = container.resolve(
      Modules.EVENT_BUS,
    ) as IEventBusModuleService

    // A Draft is not a submission the partner has made — telling them "we
    // received your payment request" would be a lie, and the run-completion
    // auto-draft fires on every completed run. It gets its own name, still
    // under the `payment_submission.*` wildcard the visual flow listens on;
    // that flow maps event names to templates explicitly and skips ones it
    // doesn't know, so a draft sends no WhatsApp until someone maps it.
    const name =
      input.status === "Draft"
        ? "payment_submission.drafted"
        : "payment_submission.created"

    await eventService.emit([
      {
        name,
        data: {
          payment_submission_id: input.submission_id,
          partner_id: input.partner_id,
          total_amount: input.total_amount,
          currency: input.currency,
          status: input.status ?? "Pending",
        },
      },
    ])
    return new StepResponse({ emitted: true })
  },
)

// Workflow
export const createPaymentSubmissionWorkflow = createWorkflow(
  "create-payment-submission",
  (input: CreatePaymentSubmissionInput) => {
    // The partner UI passes form-entered amounts via metadata so reviewers can
    // see original vs requested; honor them here as the submitted amounts.
    /**
     * The typed field wins; `metadata` is a fallback for callers that have not
     * moved yet.
     *
     * 🔴 The precedence direction matters. `metadata` accepts anything, so a
     * caller that states its intent in a typed field must not then be
     * overridden by a blob — that would put the untyped channel back in charge
     * of the money and hand #1557 its shape back. An explicit field replaces
     * the WHOLE map rather than merging key-by-key, for the same reason.
     *
     * ⚠️ The fallback is deliberately kept rather than deleted. Dropping the
     * metadata read outright would silently stop honouring any caller still
     * posting that way — their line would quietly re-price off the design's
     * stored cost, which is a money change nobody asked for. Near-miss keys are
     * refused at the route boundary instead, which is what kills the typo class.
     */
    const costOverrides = transform({ input }, (data) => {
      const moneyOf = (
        typed: Record<string, number> | undefined,
        legacy: unknown
      ) => (typed !== undefined ? typed : legacy)

      return {
        designs: sanitizeCostOverrides(
          moneyOf(data.input.cost_overrides, data.input.metadata?.design_cost_overrides)
        ),
        tasks: sanitizeCostOverrides(
          moneyOf(data.input.task_cost_overrides, data.input.metadata?.task_cost_overrides)
        ),
        designQuantities: sanitizeQuantities(
          moneyOf(data.input.quantities, data.input.metadata?.design_quantities)
        ),
        designUnitAmounts: sanitizeCostOverrides(
          moneyOf(data.input.unit_amounts, data.input.metadata?.design_unit_amounts)
        ),
      }
    })

    const validatedDesigns = validateDesignsForSubmissionStep({
      partner_id: input.partner_id,
      design_ids: input.design_ids || [],
      cost_overrides: costOverrides.designs,
      quantities: costOverrides.designQuantities,
      unit_amounts: costOverrides.designUnitAmounts,
      require_design_status: input.require_design_status,
      status: input.status,
      // Straight through as a typed input — see the field's docs for why this
      // one deliberately does not ride the metadata channel.
      production_run_ids: input.production_run_ids,
    })

    const validatedTasks = validateTasksForSubmissionStep({
      partner_id: input.partner_id,
      task_ids: input.task_ids || [],
      cost_overrides: costOverrides.tasks,
    })

    const validatedRunLines = validateRunLinesStep({
      partner_id: input.partner_id,
      run_lines: input.run_lines || [],
    })

    const validatedInventoryLines = validateInventoryOrderLinesStep({
      partner_id: input.partner_id,
      inventory_order_lines: input.inventory_order_lines || [],
    })

    const currency = resolveSubmissionCurrencyStep({
      partner_id: input.partner_id,
      currency: input.currency,
    })

    const submission = createSubmissionRecordStep({
      partner_id: input.partner_id,
      designs: validatedDesigns,
      tasks: validatedTasks,
      notes: input.notes,
      documents: input.documents,
      metadata: input.metadata,
      status: input.status,
      currency,
      runLines: validatedRunLines,
      inventoryLines: validatedInventoryLines,
    })

    linkSubmissionToPartnerStep({
      submission_id: submission.id,
      partner_id: input.partner_id,
    })

    linkSubmissionToDesignsStep({
      submission_id: submission.id,
      design_ids: input.design_ids || [],
    })

    linkSubmissionToTasksStep({
      submission_id: submission.id,
      task_ids: input.task_ids || [],
    })

    emitSubmissionCreatedStep({
      submission_id: submission.id,
      partner_id: input.partner_id,
      total_amount: submission.total_amount,
      currency: submission.currency,
      status: input.status,
    })

    return new WorkflowResponse({ submission })
  }
)
