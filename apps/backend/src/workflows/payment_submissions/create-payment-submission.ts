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
  metadata?: Record<string, any>
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
    if (input.require_design_status !== false) {
      const ineligible = typedDesigns.filter(
        (d) => !ELIGIBLE_STATUSES.includes(d.status)
      )
      if (ineligible.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Designs not eligible for payment (status must be Approved or Commerce_Ready): ${ineligible.map((d) => `${d.name || d.id} (${d.status})`).join(", ")}`
        )
      }
    }

    // 3. Validate all designs have a cost (estimated_cost, production_cost, a
    // partner-entered total override, or a caller-supplied per-unit rate)
    const overrides = input.cost_overrides || {}
    const suppliedUnitAmounts = input.unit_amounts || {}
    const noCost = typedDesigns.filter(
      (d) =>
        !overrides[d.id] &&
        !suppliedUnitAmounts[d.id] &&
        (d.estimated_cost === null || d.estimated_cost === undefined) &&
        ((d as any).production_cost === null || (d as any).production_cost === undefined)
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

    const quantities = input.quantities || {}
    const unitAmounts = input.unit_amounts || {}

    const validated: ValidatedDesign[] = typedDesigns.map((d) => {
      // `estimated_cost` / `production_cost` are PER FINISHED UNIT. Treating
      // either as a line total is the #1554 defect this resolver exists to fix.
      const line = resolveDesignLineAmount({
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
    const total_amount = designTotal + taskTotal

    if ((input.designs.length + input.tasks.length) === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "At least one design or task is required"
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
      currency: "inr",
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
        cost_breakdown: task.cost_breakdown || null,
        submission_id: submission.id,
      })
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
    const costOverrides = transform({ input }, (data) => ({
      designs: sanitizeCostOverrides(data.input.metadata?.design_cost_overrides),
      tasks: sanitizeCostOverrides(data.input.metadata?.task_cost_overrides),
      // Units billed per design. Rides the same metadata channel as the cost
      // overrides so both ends of the existing partner form keep one shape.
      designQuantities: sanitizeQuantities(data.input.metadata?.design_quantities),
      designUnitAmounts: sanitizeCostOverrides(data.input.metadata?.design_unit_amounts),
    }))

    const validatedDesigns = validateDesignsForSubmissionStep({
      partner_id: input.partner_id,
      design_ids: input.design_ids || [],
      cost_overrides: costOverrides.designs,
      quantities: costOverrides.designQuantities,
      unit_amounts: costOverrides.designUnitAmounts,
      require_design_status: input.require_design_status,
      status: input.status,
    })

    const validatedTasks = validateTasksForSubmissionStep({
      partner_id: input.partner_id,
      task_ids: input.task_ids || [],
      cost_overrides: costOverrides.tasks,
    })

    const submission = createSubmissionRecordStep({
      partner_id: input.partner_id,
      designs: validatedDesigns,
      tasks: validatedTasks,
      notes: input.notes,
      documents: input.documents,
      metadata: input.metadata,
      status: input.status,
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
