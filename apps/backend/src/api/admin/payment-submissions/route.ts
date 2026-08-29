import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../modules/payment_submissions"
import { resolvePaymentEntities } from "./lib/resolve-payment-entities"
import PaymentSubmissionsService from "../../../modules/payment_submissions/service"
import { createPaymentSubmissionWorkflow } from "../../../workflows/payment_submissions/create-payment-submission"
import {
  assertNoNearMissMoneyKey,
  foldMoneyFieldsIntoMetadata,
} from "../../../workflows/payment_submissions/lib/money-fields"

// GET /admin/payment-submissions — list all submissions with filters
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { offset = 0, limit = 20, status, partner_id, q } =
    (req.validatedQuery || req.query) as any

  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const filters: any = {}
  if (status) filters.status = status
  if (partner_id) filters.partner_id = partner_id
  // The search box on the list screen. See the validator for why it did nothing.
  if (q) filters.id = { $ilike: `%${q}%` }

  const [submissions, count] = await service.listAndCountPaymentSubmissions(
    filters,
    {
      skip: Number(offset),
      take: Number(limit),
      order: { created_at: "DESC" },
      relations: ["items"],
    }
  )

  /**
   * Who each payout is FOR, by name (#1622).
   *
   * The list rendered `partner_id.slice(0, 12)` — twelve characters of a ULID,
   * repeated down the column, on the screen whose whole job is to tell you who
   * is owed what. Best-effort per entity: a partner that cannot be resolved
   * leaves one name absent rather than failing the list.
   */
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const resolved = await resolvePaymentEntities(query, {
    partnerIds: submissions.map((s: any) => s.partner_id),
  })

  for (const submission of submissions as any[]) {
    submission.partner = submission.partner_id
      ? resolved.partners.get(submission.partner_id) ?? null
      : null
  }

  return res.status(200).json({
    payment_submissions: submissions,
    count,
    offset: Number(offset),
    limit: Number(limit),
  })
}

// POST /admin/payment-submissions — create a submission on behalf of a partner
// Reuses the shared createPaymentSubmissionWorkflow which validates ownership
// and eligibility regardless of whether a partner or an admin is calling it.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req as any).validatedBody as {
    partner_id: string
    design_ids?: string[]
    task_ids?: string[]
    notes?: string
    documents?: Array<{ id?: string; url: string; filename?: string; mimeType?: string }>
    quantities?: Record<string, number>
    unit_amounts?: Record<string, number>
    production_run_ids?: Record<string, string[]>
    status?: "Draft" | "Pending"
    require_design_status?: boolean
    metadata?: Record<string, any>
    currency?: string
    run_lines?: Array<{
      run_ids: string[]
      amount?: number
      quantity?: number
      order_id?: string
      label?: string
      currency?: string
    }>
    inventory_order_lines?: Array<{
      inventory_order_id: string
      amount?: number
      currency?: string
    }>
  }

  assertNoNearMissMoneyKey(body.metadata)

  const { result } = await createPaymentSubmissionWorkflow(req.scope).run({
    input: {
      partner_id: body.partner_id,
      design_ids: body.design_ids || [],
      task_ids: body.task_ids || [],
      notes: body.notes,
      documents: body.documents,
      status: body.status,
      require_design_status: body.require_design_status,
      // Typed input, not folded into metadata — this is the double-pay guard's
      // evidence, and it must not be reachable by a misspelt JSON key.
      production_run_ids: body.production_run_ids,
      /**
       * Per-piece prices within one line (#1596). Typed only — never metadata.
       *
       * ⚠️ Cast for the same reason `cost_overrides` below is: the money
       * fragment is spread from a plain-`zod` module into a schema built with
       * `@medusajs/framework/zod`, and the spread's types do not survive the
       * mix. The VALIDATOR still enforces the shape; only tsc loses sight of it.
       */
      rate_breakdown: (body as any).rate_breakdown,
      // 🔴 Forwarded explicitly. A field the validator accepts but the handler
      // never passes on is dropped in SILENCE — the request succeeds, the line
      // is simply not there, and no dry-run can reveal it.
      run_lines: body.run_lines,
      inventory_order_lines: body.inventory_order_lines,
      currency: body.currency,
      // The money, as typed inputs. These are the contract; the fold below
      // keeps the same values on `metadata` so the review UI and any existing
      // reader still see original vs. requested exactly as before.
      quantities: body.quantities,
      unit_amounts: body.unit_amounts,
      cost_overrides: (body as any).cost_overrides,
      task_cost_overrides: (body as any).task_cost_overrides,
      metadata: {
        // Typed money fields win over the metadata channel and land on it —
        // see `foldMoneyFieldsIntoMetadata` for why the precedence is per-field
        // and one-way rather than a per-key merge.
        ...foldMoneyFieldsIntoMetadata(body),
        // Mark the origin so reviewers can tell admin-created submissions apart
        created_by: "admin",
      },
    },
  })

  return res.status(201).json({ payment_submission: result.submission })
}
