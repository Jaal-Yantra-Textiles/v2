import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// #843 — the partner production-run listing, lifted out of
// `GET /partners/production-runs` into a workflow so the admin inspection
// mirror (`GET /admin/partners/:id/production-runs`) runs the *same* read
// instead of re-deriving the scoping and field set. A divergence in either
// would silently blank columns in the mirror or, worse, show an operator a
// different set of runs than the partner sees.

export type ListPartnerProductionRunsWorkflowInput = {
  partnerId: string
  status?: string
  role?: string
  run_type?: "production" | "sample"
  design_id?: string
  offset: number
  limit: number
  /** Forwarded to `query.graph` for translated fields; the route reads it off the request. */
  locale?: string
}

/**
 * The field set both surfaces read with. Kept in one place for the same reason
 * `PARTNER_ORDER_LIST_FIELDS` is (#1175): two copies drift, and the drift is
 * invisible until a column blanks out in the mirror.
 */
export const PARTNER_PRODUCTION_RUN_LIST_FIELDS = [
  "id",
  "status",
  "run_type",
  "quantity",
  "role",
  "design_id",
  "partner_id",
  "parent_run_id",
  "product_id",
  "variant_id",
  "order_id",
  "order_line_item_id",
  "accepted_at",
  "started_at",
  "finished_at",
  "completed_at",
  "cancelled_at",
  "cancelled_reason",
  "finish_notes",
  "completion_notes",
  "partner_cost_estimate",
  "cost_type",
  "produced_quantity",
  "rejected_quantity",
  "rejection_reason",
  "rejection_notes",
  "depends_on_run_ids",
  "metadata",
  "created_at",
  "updated_at",
  "tasks.*",
  // `order.id` resolves the order↔production_run link (#342 D5) so the design
  // page can deep-link each run to its unified order detail (`/orders/:id`).
  // NB: this is the LINK accessor, distinct from the plain legacy `order_id`
  // column above (the original retail order line the run was created from).
  "order.id",
]

export const listPartnerProductionRunsStep = createStep(
  "list-partner-production-runs",
  async (input: ListPartnerProductionRunsWorkflowInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const filters: any = { partner_id: input.partnerId }
    if (input.status) {
      filters.status = input.status
    }
    if (input.role) {
      filters.role = input.role
    }
    if (input.run_type) {
      filters.run_type = input.run_type
    }
    if (input.design_id) {
      filters.design_id = input.design_id
    }

    const { data: runs, metadata } = await query.graph(
      {
        entity: "production_runs",
        fields: PARTNER_PRODUCTION_RUN_LIST_FIELDS,
        filters,
        pagination: { skip: input.offset, take: input.limit },
      },
      { locale: input.locale }
    )

    return new StepResponse({
      runs: runs || [],
      count: (metadata as any)?.count ?? (runs || []).length,
    })
  }
)

export const listPartnerProductionRunsWorkflow = createWorkflow(
  "list-partner-production-runs",
  (input: ListPartnerProductionRunsWorkflowInput) => {
    const listed = listPartnerProductionRunsStep(input)

    const output = transform({ listed, input }, ({ listed, input }) => ({
      // `unified_order_id` flattens the 1:1 order link, which `query.graph`
      // resolves to either an object or a single-element array depending on the
      // accessor — tolerate both rather than betting on one shape.
      production_runs: (listed.runs as any[]).map((run: any) => ({
        ...run,
        unified_order_id: Array.isArray(run?.order)
          ? run.order[0]?.id
          : run?.order?.id,
      })),
      count: listed.count,
      limit: input.limit,
      offset: input.offset,
    }))

    return new WorkflowResponse(output)
  }
)
