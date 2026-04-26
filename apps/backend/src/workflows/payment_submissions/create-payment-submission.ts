import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"
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
}

type ValidatedDesign = {
  id: string
  name: string
  estimated_cost: number
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

// Step 1a: Validate all designs for submission eligibility
const validateDesignsForSubmissionStep = createStep(
  "validate-designs-for-submission",
  async (
    input: { partner_id: string; design_ids: string[] },
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

    // 2. Validate status — must be Commerce_Ready or Approved
    const ELIGIBLE_STATUSES = ["Commerce_Ready", "Approved"]
    const ineligible = typedDesigns.filter(
      (d) => !ELIGIBLE_STATUSES.includes(d.status)
    )
    if (ineligible.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Designs not eligible for payment (status must be Approved or Commerce_Ready): ${ineligible.map((d) => `${d.name || d.id} (${d.status})`).join(", ")}`
      )
    }

    // 3. Validate all designs have a cost (estimated_cost or production_cost)
    const noCost = typedDesigns.filter(
      (d) =>
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

    const typedExistingLinks = existingLinks as unknown as SubmissionDesignLinkResult[]
    const activeSubmissionDesigns = (typedExistingLinks || []).filter((link) => {
      const status = link.payment_submission?.status
      return status === "Pending" || status === "Under_Review"
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

    const validated: ValidatedDesign[] = typedDesigns.map((d) => ({
      id: d.id,
      name: d.name,
      estimated_cost: Number(d.estimated_cost || (d as any).production_cost || 0),
      cost_breakdown: d.cost_breakdown,
    }))

    return new StepResponse(validated)
  }
)

// Step 1b: Validate all tasks for submission eligibility
const validateTasksForSubmissionStep = createStep(
  "validate-tasks-for-submission",
  async (
    input: { partner_id: string; task_ids: string[] },
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

    // 3. Every task must have a cost (prefer actual_cost, fall back to estimated_cost)
    const noCost = typedTasks.filter(
      (t) =>
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
      amount: Number(t.actual_cost ?? t.estimated_cost ?? 0),
      cost_breakdown: {
        cost_currency: t.cost_currency,
        cost_type: t.cost_type,
        estimated_cost: t.estimated_cost,
        actual_cost: t.actual_cost,
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
    const submission = await service.createPaymentSubmissions({
      partner_id: input.partner_id,
      status: "Pending",
      total_amount,
      currency: "inr",
      submitted_at: new Date(),
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

// Workflow
export const createPaymentSubmissionWorkflow = createWorkflow(
  "create-payment-submission",
  (input: CreatePaymentSubmissionInput) => {
    const validatedDesigns = validateDesignsForSubmissionStep({
      partner_id: input.partner_id,
      design_ids: input.design_ids || [],
    })

    const validatedTasks = validateTasksForSubmissionStep({
      partner_id: input.partner_id,
      task_ids: input.task_ids || [],
    })

    const submission = createSubmissionRecordStep({
      partner_id: input.partner_id,
      designs: validatedDesigns,
      tasks: validatedTasks,
      notes: input.notes,
      documents: input.documents,
      metadata: input.metadata,
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

    return new WorkflowResponse({ submission })
  }
)
