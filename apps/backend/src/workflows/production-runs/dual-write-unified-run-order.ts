import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import type { Link } from "@medusajs/modules-sdk"
import type { LinkDefinition } from "@medusajs/framework/types"
import type { MedusaContainer } from "@medusajs/framework/types"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { PARTNER_MODULE } from "../../modules/partner"
import { DESIGN_MODULE } from "../../modules/designs"
import type ProductionRunService from "../../modules/production_runs/service"
import { PARTNER_WORK_ORDERS_CHANNEL } from "../inventory_orders/dual-write-unified-order"

// #342 T3.2 — best-effort projection of production runs onto the core `order`
// entity (metadata.kind = "design"). Mirrors the T2 inventory-order recipe;
// see apps/docs/notes/ORDERS_UNIFICATION_342.md §4 + §5. Failure must never
// fail the legacy path, so every entry point swallows errors and reports via
// logger.warn with the [orders-unification] prefix.
//
// Deviation from §4's "run gains order_id → unified order": during the shim
// phase the unified order id lives in run.metadata.unified_order_id, NOT in
// run.order_id — that column still means "the customer retail order that
// spawned the run" and is read by stockFinishedGoodsStep (reservations) and
// run provenance. Repointing it is a T4 concern.

// §5 — run status → core order.status. The work-progress dimension lives in
// metadata.partner_status (below).
const RUN_TO_CORE_STATUS: Record<string, string> = {
  draft: "draft",
  pending_review: "draft",
  approved: "pending",
  sent_to_partner: "pending",
  in_progress: "pending",
  completed: "completed",
  cancelled: "canceled",
}

// §5 — the shared assigned→accepted→in_progress→finished→completed
// vocabulary. The legacy run enum collapses accepted/started/finished into
// one "in_progress" value; the lifecycle timestamps disambiguate. approved/
// draft/pending_review are absent on purpose (no partner work yet), and
// cancelled only maps to "declined" when the cancel came from a partner
// decline — an admin cancel leaves the last value untouched (§5 table
// defines no value for it).
const deriveRunPartnerStatus = (
  run: any,
  opts: { declined?: boolean } = {}
): string | undefined => {
  switch (run.status) {
    case "sent_to_partner":
      return "assigned"
    case "in_progress":
      if (run.finished_at) return "finished"
      if (run.started_at) return "in_progress"
      if (run.accepted_at) return "accepted"
      // Partner self-serve runs are born in_progress with no lifecycle
      // timestamps — the partner is already working on it.
      return "in_progress"
    case "completed":
      return "completed"
    case "cancelled":
      return opts.declined ? "declined" : undefined
    default:
      return undefined
  }
}

type ProjectionResult = {
  unified_order_id: string | null
  skipped?: string
  error?: string
}

type MirrorResult = {
  linked: boolean
  unified_order_id?: string
  skipped?: string
  error?: string
}

const resolveRegionAndCurrency = async (container: MedusaContainer) => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_region_id", "supported_currencies.*"],
  })
  const store = stores?.[0]
  let regionId: string | undefined = store?.default_region_id ?? undefined
  if (!regionId) {
    const { data: regions } = await query.graph({
      entity: "region",
      fields: ["id"],
      pagination: { take: 1 },
    })
    regionId = regions?.[0]?.id
  }
  const currencyCode =
    store?.supported_currencies?.find((c: any) => c?.is_default)
      ?.currency_code ?? "inr"
  return { regionId, currencyCode }
}

const ensureWorkOrdersChannel = async (container: MedusaContainer) => {
  const salesChannelService: any = container.resolve(Modules.SALES_CHANNEL)
  let [channel] = await salesChannelService.listSalesChannels({
    name: PARTNER_WORK_ORDERS_CHANNEL,
  })
  if (!channel) {
    channel = await salesChannelService.createSalesChannels({
      name: PARTNER_WORK_ORDERS_CHANNEL,
      description:
        "Internal channel for unified partner work-orders (#342). Not a storefront.",
    })
  }
  return channel
}

const createPartnerOrderLink = async (
  container: MedusaContainer,
  partnerId: string,
  orderId: string,
  role?: string
) => {
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  const links: LinkDefinition[] = [
    {
      [PARTNER_MODULE]: { partner_id: partnerId },
      [Modules.ORDER]: { order_id: orderId },
      data: {
        partner_id: partnerId,
        order_id: orderId,
        assigned_at: new Date().toISOString(),
        ...(role ? { role } : {}),
      },
    },
  ]
  await remoteLink.create(links)
}

const patchUnifiedOrder = async (
  container: MedusaContainer,
  unifiedOrderId: string,
  patch: { status?: string; metadata?: Record<string, unknown> }
) => {
  const orderService: any = container.resolve(Modules.ORDER)
  if (patch.metadata) {
    const current = await orderService.retrieveOrder(unifiedOrderId, {
      select: ["id", "metadata"],
    })
    patch.metadata = { ...(current?.metadata ?? {}), ...patch.metadata }
  }
  await orderService.updateOrders([
    {
      id: unifiedOrderId,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.metadata ? { metadata: patch.metadata } : {}),
    },
  ])
}

/**
 * Project ONE run onto a kind=design core order (§4). The order represents
 * "JYT commissions partner X to produce design Y, qty N, at cost C" — one
 * line item per design. Idempotent on run.metadata.unified_order_id.
 *
 * Exported as a plain function so the create/approve steps, the admin cancel
 * route and the task subscriber can all share it without composing workflows.
 */
export const projectRunToUnifiedOrder = async (
  container: MedusaContainer,
  productionRunId: string
): Promise<ProjectionResult> => {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const productionRunService: ProductionRunService =
      container.resolve(PRODUCTION_RUNS_MODULE)
    const run: any = await productionRunService.retrieveProductionRun(
      productionRunId
    )

    // D5-2 idempotency: the order↔production_run link is the authoritative
    // "already projected" signal. Resolve it forward (run → order) via
    // query.graph — that join is synchronous/authoritative; never query.index
    // here (eventually consistent). Fall back to the legacy
    // metadata.unified_order_id backref so runs projected before D5-2
    // (link-less) are not re-projected into a duplicate order.
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: linkedRuns } = await query.graph({
      entity: "production_runs",
      fields: ["id", "order.id"],
      filters: { id: productionRunId },
    })
    const alreadyProjectedId =
      linkedRuns?.[0]?.order?.id ?? run?.metadata?.unified_order_id
    if (alreadyProjectedId) {
      return {
        unified_order_id: alreadyProjectedId,
        skipped: "already_projected",
      }
    }

    const { regionId, currencyCode } = await resolveRegionAndCurrency(container)
    if (!regionId) {
      logger.warn(
        `[orders-unification] skipped run dual-write for ${productionRunId}: no region exists`
      )
      return { unified_order_id: null, skipped: "no_region" }
    }

    const channel = await ensureWorkOrdersChannel(container)

    // GAP-4: cost_type "total" → derive unit price; "per_unit" is already a
    // unit price. No estimate yet (admin sets it later) → 0; the original is
    // preserved in metadata for parity checks and T4 backfill.
    const quantity = Number(run.quantity) || 1
    const estimate = Number(run.partner_cost_estimate) || 0
    const unitPrice =
      run.cost_type === "per_unit" ? estimate : quantity > 0 ? estimate / quantity : estimate

    const designTitle =
      run.snapshot?.design?.name ?? `Design ${run.design_id}`

    // Legacy metadata wins on collision except the unification keys (§3/§4).
    const metadata: Record<string, unknown> = {
      ...(run.metadata ?? {}),
      kind: "design",
      legacy_id: run.id,
      production_run_id: run.id,
      run_type: run.run_type ?? "production",
      execution_mode: run.execution_mode ?? "in_house",
      source_order_id: run.order_id ?? null,
      source_line_item_id: run.order_line_item_id ?? null,
      currency_assumed: true,
    }

    const partnerStatus = deriveRunPartnerStatus(run)
    if (partnerStatus) {
      metadata.partner_status = partnerStatus
    }

    // GAP-3 recipe: omit customer_id AND email so the order is created
    // customer-less (the "customer" of a work-order is JYT itself).
    const { result: unified } = await createOrderWorkflow(container).run({
      input: {
        region_id: regionId,
        sales_channel_id: channel.id,
        currency_code: currencyCode,
        status: (RUN_TO_CORE_STATUS[run.status] ?? "pending") as any,
        items: [
          {
            title: designTitle,
            quantity,
            unit_price: unitPrice,
            metadata: {
              design_id: run.design_id,
              cost_type: run.cost_type ?? null,
              legacy_cost_estimate: run.partner_cost_estimate ?? null,
              production_run_id: run.id,
            },
          },
        ] as any,
        metadata,
      },
    })

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    // D5-2 — the load-bearing order↔production_run link + kind=design
    // discriminator (replaces metadata.unified_order_id as the authoritative
    // pointer; the metadata backref is still written below during the D5
    // transition). filterable:["id"] means the Index Module ingests it so the
    // admin retail-list anti-join can exclude work-orders (Chunk 4).
    await remoteLink
      .create([
        {
          [Modules.ORDER]: { order_id: unified.id },
          [PRODUCTION_RUNS_MODULE]: { production_runs_id: run.id },
        },
      ])
      .catch((e: any) =>
        logger.warn(
          `[orders-unification] order↔production_run link failed for ${run.id}: ${e?.message}`
        )
      )

    // §4 — reuse the existing design↔order link infra (#29) so design panels
    // and linkDesignsToOrder consumers see the work-order too.
    if (run.design_id) {
      await remoteLink
        .create([
          {
            [DESIGN_MODULE]: { design_id: run.design_id },
            [Modules.ORDER]: { order_id: unified.id },
          },
        ])
        .catch((e: any) =>
          logger.warn(
            `[orders-unification] design link failed for ${run.id}: ${e?.message}`
          )
        )
    }

    // Partner scoping: runs born at/past sent_to_partner (child runs are
    // linked by the send mirror instead; partner self-serve runs are born
    // in_progress and need the link immediately).
    if (
      run.partner_id &&
      ["sent_to_partner", "in_progress", "completed"].includes(run.status)
    ) {
      await createPartnerOrderLink(container, run.partner_id, unified.id)
      if (run.execution_mode === "outsourced" && run.sub_partner_id) {
        await createPartnerOrderLink(
          container,
          run.sub_partner_id,
          unified.id,
          "sub_partner"
        )
      }
    }

    await productionRunService.updateProductionRuns({
      id: run.id,
      metadata: {
        ...(run.metadata ?? {}),
        unified_order_id: unified.id,
      },
    })

    return { unified_order_id: unified.id }
  } catch (e: any) {
    logger.warn(
      `[orders-unification] run dual-write failed for ${productionRunId}: ${e?.message}`
    )
    return { unified_order_id: null, error: e?.message }
  }
}

/**
 * Mirror a run's current status onto its unified order per §5. Re-reads the
 * run from DB (not workflow input) so compensations mirror correctly too.
 * Safe to call from non-workflow code (routes, subscribers).
 */
export const mirrorRunStatusToUnifiedOrder = async (
  container: MedusaContainer,
  productionRunId: string,
  opts: { declined?: boolean } = {}
): Promise<MirrorResult> => {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const productionRunService: ProductionRunService =
      container.resolve(PRODUCTION_RUNS_MODULE)
    const run: any = await productionRunService
      .retrieveProductionRun(productionRunId)
      .catch(() => null)

    const unifiedOrderId = run?.metadata?.unified_order_id
    if (!unifiedOrderId) {
      return { linked: false, skipped: "no_unified_order" }
    }

    const orderService: any = container.resolve(Modules.ORDER)
    const unifiedOrder = await orderService.retrieveOrder(unifiedOrderId, {
      select: ["id", "metadata"],
    })

    // A parent order superseded by a run split stays canceled forever —
    // the child orders carry the commercial reality.
    if (unifiedOrder?.metadata?.superseded_by_run_ids) {
      return { linked: false, skipped: "superseded" }
    }

    const coreStatus = RUN_TO_CORE_STATUS[run.status]
    const partnerStatus = deriveRunPartnerStatus(run, opts)

    await orderService.updateOrders([
      {
        id: unifiedOrderId,
        ...(coreStatus ? { status: coreStatus } : {}),
        ...(partnerStatus
          ? {
              metadata: {
                ...(unifiedOrder?.metadata ?? {}),
                partner_status: partnerStatus,
              },
            }
          : {}),
      },
    ])

    return { linked: true, unified_order_id: unifiedOrderId }
  } catch (e: any) {
    logger.warn(
      `[orders-unification] run status mirror failed for ${productionRunId}: ${e?.message}`
    )
    return { linked: false, error: e?.message }
  }
}

// Create-side step: appended to createProductionRunWorkflow. Covers admin
// top-level runs and partner self-serve runs (born in_progress).
export const dualWriteUnifiedRunOrderStep = createStep(
  "dual-write-unified-run-order",
  async (input: { production_run_id: string }, { container }) => {
    const result = await projectRunToUnifiedOrder(
      container,
      input.production_run_id
    )
    return new StepResponse<ProjectionResult>(result)
  }
)

// Approve-side step: §4 says one unified order per CHILD run (the
// partner-facing unit). When approve splits a parent into child runs, each
// child gets its own order and the parent's order — projected at create time,
// before we could know it would become a planning artifact — is canceled and
// marked superseded so billing never double-counts the work.
export const dualWriteChildRunOrdersStep = createStep(
  "dual-write-child-run-orders",
  async (
    input: { parent_run_id: string; child_run_ids: string[] },
    { container }
  ) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    try {
      for (const childId of input.child_run_ids) {
        await projectRunToUnifiedOrder(container, childId)
      }

      if (input.child_run_ids.length) {
        const productionRunService: ProductionRunService =
          container.resolve(PRODUCTION_RUNS_MODULE)
        const parent: any = await productionRunService
          .retrieveProductionRun(input.parent_run_id)
          .catch(() => null)
        const parentOrderId = parent?.metadata?.unified_order_id
        if (parentOrderId) {
          await patchUnifiedOrder(container, parentOrderId, {
            status: "canceled",
            metadata: { superseded_by_run_ids: input.child_run_ids },
          })
        }
      } else {
        // No split — the run itself stays the partner-facing unit; mirror
        // its approved status.
        await mirrorRunStatusToUnifiedOrder(container, input.parent_run_id)
      }

      return new StepResponse({ projected: input.child_run_ids.length })
    } catch (e: any) {
      logger.warn(
        `[orders-unification] child run dual-write failed for ${input.parent_run_id}: ${e?.message}`
      )
      return new StepResponse({ projected: 0, error: e?.message })
    }
  }
)

// Send-side mirror: once the run is dispatched the partner is committed —
// scope the unified order to them (D3 link) and stamp partner_status
// "assigned" (§5). Same best-effort contract as the other steps.
export const mirrorRunPartnerLinkOnUnifiedOrderStep = createStep(
  "mirror-run-partner-link-on-unified-order",
  async (input: { production_run_id: string }, { container }) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    try {
      const productionRunService: ProductionRunService =
        container.resolve(PRODUCTION_RUNS_MODULE)
      const run: any = await productionRunService
        .retrieveProductionRun(input.production_run_id)
        .catch(() => null)

      const unifiedOrderId = run?.metadata?.unified_order_id
      if (!unifiedOrderId || !run?.partner_id) {
        return new StepResponse<MirrorResult>({
          linked: false,
          skipped: !unifiedOrderId ? "no_unified_order" : "no_partner",
        })
      }

      await createPartnerOrderLink(container, run.partner_id, unifiedOrderId)
      if (run.execution_mode === "outsourced" && run.sub_partner_id) {
        await createPartnerOrderLink(
          container,
          run.sub_partner_id,
          unifiedOrderId,
          "sub_partner"
        )
      }

      await patchUnifiedOrder(container, unifiedOrderId, {
        metadata: { partner_status: "assigned" },
      })

      return new StepResponse<MirrorResult>({
        linked: true,
        unified_order_id: unifiedOrderId,
      })
    } catch (e: any) {
      logger.warn(
        `[orders-unification] run partner link mirror failed for ${input.production_run_id}: ${e?.message}`
      )
      return new StepResponse<MirrorResult>({ linked: false, error: e?.message })
    }
  }
)

// Status mirror: appended to every run lifecycle workflow (accept, start,
// finish, complete, decline, send) so partner actions, admin actions and
// their compensations all converge through one path.
export const mirrorUnifiedRunOrderStatusStep = createStep(
  "mirror-unified-run-order-status",
  async (
    input: { production_run_id: string; declined?: boolean },
    { container }
  ) => {
    const result = await mirrorRunStatusToUnifiedOrder(
      container,
      input.production_run_id,
      { declined: input.declined }
    )
    return new StepResponse<MirrorResult>(result)
  }
)
