import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  createOrderWorkflow,
  beginOrderEditOrderWorkflow,
  orderEditAddNewItemWorkflow,
  confirmOrderEditRequestWorkflow,
} from "@medusajs/medusa/core-flows"
import type { Link } from "@medusajs/modules-sdk"
import type { LinkDefinition } from "@medusajs/framework/types"
import type { MedusaContainer } from "@medusajs/framework/types"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { PARTNER_MODULE } from "../../modules/partner"
import { DESIGN_MODULE } from "../../modules/designs"
import PartnerOrderLink from "../../links/partner-order"
import type ProductionRunService from "../../modules/production_runs/service"
import {
  PARTNER_WORK_ORDERS_CHANNEL,
  resolveUnifiedOrderIdByLink,
  linkUnifiedOrderOrRollback,
  setUnifiedOrderPartnerStatus,
} from "../inventory_orders/dual-write-unified-order"
import { pickDefaultCurrency } from "../../lib/resolve-store-currency"
import {
  aggregatePartnerStatus,
  deriveRunPartnerStatus,
} from "./lib/run-partner-status"

// #342 T3.2 — best-effort projection of production runs onto the core `order`
// entity (kind=design = "the order↔production_run link exists"; Chunk 6 retired
// the metadata.kind discriminator). Mirrors the T2 inventory-order recipe; see
// apps/docs/notes/ORDERS_UNIFICATION_342.md §4 + §5. Failure must never fail the
// legacy path, so every entry point swallows errors and reports via logger.warn
// with the [orders-unification] prefix.
//
// Deviation from §4's "run gains order_id → unified order": the pointer from a
// run to its unified order is the order↔production_run link (Chunk 6 stopped
// writing the transitional run.metadata.unified_order_id backref). run.order_id
// is NOT repointed — that column still means "the customer retail order that
// spawned the run" and is read by stockFinishedGoodsStep (reservations) and run
// provenance. Repointing it is a T4 concern.

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
  // #485: centralised default-currency selection (was a hand-rolled is_default
  // scan). Partner is linked AFTER creation, so the platform/base store
  // currency is stamped now; the #457 backfill re-stamps to partner currency.
  const currencyCode = pickDefaultCurrency(store, "inr")
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
  // PR-H retired the per-order metadata lock. The only metadata this patches now
  // is `superseded_by_run_ids` — written once, by the single approve-time writer
  // (dualWriteChildRunOrdersStep), with no concurrent metadata writer (partner_
  // status moved to the sidecar column). The read-then-merge still runs to
  // preserve the create-time keys updateOrders would otherwise replace, but it
  // needs no lock.
  if (patch.metadata) {
    const current = await orderService.retrieveOrder(unifiedOrderId, {
      select: ["id", "metadata"],
    })
    const mergedMetadata = { ...(current?.metadata ?? {}), ...patch.metadata }
    await orderService.updateOrders([
      {
        id: unifiedOrderId,
        ...(patch.status ? { status: patch.status } : {}),
        metadata: mergedMetadata,
      },
    ])
    return
  }
  await orderService.updateOrders([
    {
      id: unifiedOrderId,
      ...(patch.status ? { status: patch.status } : {}),
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
      legacy_id: run.id,
      production_run_id: run.id,
      run_type: run.run_type ?? "production",
      execution_mode: run.execution_mode ?? "in_house",
      source_order_id: run.order_id ?? null,
      source_line_item_id: run.order_line_item_id ?? null,
      currency_assumed: true,
    }

    // PR-H — partner_status is no longer written to metadata; it goes only onto
    // the typed `unified_order_status` sidecar column (set below, after the order
    // + link exist).
    const partnerStatus = deriveRunPartnerStatus(run)

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

    // D5-2 / Chunk 6 — the load-bearing order↔production_run link is the SOLE
    // discriminator + pointer (kind=design is "this link exists").
    // filterable:["id"] means the Index Module ingests it so the admin retail-
    // list anti-join can exclude work-orders (Chunk 4). Authoritative: a link
    // failure rolls back the just-created order rather than orphaning it — the
    // metadata.unified_order_id backref that used to be the safety net is no
    // longer written (Chunk 6).
    await linkUnifiedOrderOrRollback(container, unified.id, {
      [Modules.ORDER]: { order_id: unified.id },
      [PRODUCTION_RUNS_MODULE]: { production_runs_id: run.id },
    })

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

    // Chunk 9b (PR-F) — when the projection derived a partner_status (the run is
    // born at/past sent_to_partner), also write the typed sidecar column. This
    // single-shot create path establishes the sidecar row before any concurrent
    // mirror can run, so the column find-or-create never races. BOTH surfaces
    // during expand; best-effort so it never regresses the metadata projection.
    if (partnerStatus) {
      await setUnifiedOrderPartnerStatus(
        container,
        unified.id,
        partnerStatus
      ).catch((e: any) =>
        logger.warn(
          `[orders-unification] sidecar status write failed for ${unified.id}: ${e?.message}`
        )
      )
    }

    return { unified_order_id: unified.id }
  } catch (e: any) {
    logger.warn(
      `[orders-unification] run dual-write failed for ${productionRunId}: ${e?.message}`
    )
    return { unified_order_id: null, error: e?.message }
  }
}

// #826 S3a — aggregate the core order.status for a COLLATED design work-order
// from its N runs. Cancelled runs are dropped a design line pulled from the
// order, so completion rides on the ACTIVE (non-cancelled) runs: completed iff
// every active run completed; canceled iff ALL runs cancelled; else pending.
// (#826 follow-up: this stops a collated order stranding in "pending" forever
// when one design was cancelled but the rest completed.)
/**
 * One work-order line per run — the design's name, its quantity, and pointers
 * back to the run that produced it.
 *
 * 🔑 ONE home, because there are now two writers: `collateRunsIntoWorkOrder`
 * creating a fresh order, and `joinRunsIntoWorkOrder` appending to one that
 * already exists (#1597). Two builders would drift, and a line that describes
 * itself differently depending on which door it came through is exactly how the
 * run-line pricer ended up 22% apart from itself.
 *
 * ⚠️ `unit_price` divides a `total` estimate by quantity, because a core line
 * item is priced per unit. `cost_type` is carried in metadata so nothing
 * downstream has to re-derive which of the two it was (#1559).
 */
export const buildWorkOrderItems = (runs: any[]) =>
  runs.map((run) => {
    const quantity = Number(run.quantity) || 1
    const estimate = Number(run.partner_cost_estimate) || 0
    const unitPrice =
      run.cost_type === "per_unit"
        ? estimate
        : quantity > 0
        ? estimate / quantity
        : estimate
    return {
      title: run.snapshot?.design?.name ?? `Design ${run.design_id}`,
      quantity,
      unit_price: unitPrice,
      metadata: {
        design_id: run.design_id,
        production_run_id: run.id,
        cost_type: run.cost_type ?? null,
        legacy_cost_estimate: run.partner_cost_estimate ?? null,
      },
    }
  })

const aggregateCoreStatus = (runs: any[]): string => {
  if (!runs.length) return "pending"
  const active = runs.filter((r) => r.status !== "cancelled")
  if (!active.length) return "canceled" // every run cancelled
  if (active.every((r) => r.status === "completed")) return "completed"
  return "pending"
}

// #826 S3a — aggregate partner_status for a collated design work-order: the
// LEAST-advanced non-empty per-run status along assigned→accepted→in_progress→
// finished→completed (the order isn't "completed" until every line is).
type CollatedProjectionResult = ProjectionResult & { line_count?: number }

/**
 * #826 S3a — project a design COMMISSIONING order's runs onto ONE collated
 * kind=design work-order: N line items, one per run/design (the design analog
 * of inventory's one-order → N-orderlines → one work-order projection). Grouped
 * by `run.order_id` = the commissioning order. The per-run projection is
 * suppressed for these runs (skip_unified_projection), so this is the SOLE
 * projection and the order↔run link is 1:many (all N runs → this one order).
 *
 * Idempotent: if the order's runs already share a linked work-order, returns it.
 * Best-effort like the per-run projection — never throws to the caller.
 */
export const projectDesignOrderToUnifiedOrder = async (
  container: MedusaContainer,
  commissioningOrderId: string
): Promise<CollatedProjectionResult> => {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const runService: ProductionRunService =
      container.resolve(PRODUCTION_RUNS_MODULE)
    const runs: any[] = await runService.listProductionRuns(
      { order_id: [commissioningOrderId] } as any,
      {
        select: [
          "id",
          "design_id",
          "partner_id",
          "quantity",
          "status",
          "cost_type",
          "partner_cost_estimate",
          "execution_mode",
          "sub_partner_id",
          "order_line_item_id",
          "snapshot",
        ],
      }
    )
    if (!runs.length) {
      return { unified_order_id: null, skipped: "no_runs" }
    }

    // Idempotency: any run already linked to a work-order → that IS the collated
    // order (forward run→order link is authoritative). query.graph, never index.
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: linkedRuns } = await query.graph({
      entity: "production_runs",
      fields: ["id", "order.id"],
      filters: { id: runs.map((r) => r.id) },
    })
    const already = (linkedRuns || []).find((r: any) => r?.order?.id)?.order?.id
    if (already) {
      return { unified_order_id: already, skipped: "already_projected" }
    }

    return await collateRunsIntoWorkOrder(container, runs, {
      sourceOrderId: commissioningOrderId,
    })
  } catch (e: any) {
    logger.warn(
      `[orders-unification] collated design-order projection failed for ${commissioningOrderId}: ${e?.message}`
    )
    return { unified_order_id: null, error: e?.message }
  }
}

/**
 * #826 — the shared core: given a set of production runs, create ONE collated
 * kind=design work-order (a line per run/design) and wire all the links +
 * aggregated status. Used by both the commissioning-order path
 * (projectDesignOrderToUnifiedOrder) and the no-customer path
 * (produceDesignsAsWorkOrder). `sourceOrderId` is the commissioning order when
 * there is one (null for a direct produce).
 */
export const collateRunsIntoWorkOrder = async (
  container: MedusaContainer,
  runs: any[],
  opts: { sourceOrderId?: string | null } = {}
): Promise<CollatedProjectionResult> => {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { regionId, currencyCode } = await resolveRegionAndCurrency(container)
  if (!regionId) {
    logger.warn(
      `[orders-unification] skipped collated work-order: no region exists`
    )
    return { unified_order_id: null, skipped: "no_region" }
  }
  const channel = await ensureWorkOrdersChannel(container)

  // One line item per run — self-describing (design name + run pointer).
  const items = buildWorkOrderItems(runs)

  const { result: unified }: any = await createOrderWorkflow(container).run({
    input: {
      region_id: regionId,
      sales_channel_id: channel.id,
      currency_code: currencyCode,
      status: aggregateCoreStatus(runs) as any,
      items: items as any,
      metadata: {
        // The commissioning order this collates (null for a direct produce).
        source_order_id: opts.sourceOrderId ?? null,
        collated_design_order: true,
        production_run_ids: runs.map((r) => r.id),
        // Keep a legacy_id pointer so use-order-kind consumers that read
        // order.metadata.legacy_id still resolve a run (S3b renders N lines
        // off the order items rather than this single pointer).
        legacy_id: runs[0].id,
        currency_assumed: true,
      },
    },
  })

  // order↔run for EACH run (1:many). First via the rollback path so the
  // kind=design discriminator link exists-or-the-order-rolls-back; the rest
  // best-effort (a stray link failure must not orphan the whole order).
  await linkUnifiedOrderOrRollback(container, unified.id, {
    [Modules.ORDER]: { order_id: unified.id },
    [PRODUCTION_RUNS_MODULE]: { production_runs_id: runs[0].id },
  })
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  for (const run of runs.slice(1)) {
    await remoteLink
      .create([
        {
          [Modules.ORDER]: { order_id: unified.id },
          [PRODUCTION_RUNS_MODULE]: { production_runs_id: run.id },
        },
      ])
      .catch((e: any) =>
        logger.warn(
          `[orders-unification] collated order↔run link failed for run ${run.id}: ${e?.message}`
        )
      )
  }

  // design↔order per distinct design (reuse #29 design-order link infra).
  const designIds = Array.from(
    new Set(runs.map((r) => r.design_id).filter(Boolean))
  )
  for (const designId of designIds) {
    await remoteLink
      .create([
        {
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.ORDER]: { order_id: unified.id },
        },
      ])
      .catch((e: any) =>
        logger.warn(
          `[orders-unification] collated design link failed for ${designId}: ${e?.message}`
        )
      )
  }

  // partner↔order (D3) per distinct partner among runs already at/past
  // sent_to_partner (the partner is committed).
  const partnerIds = Array.from(
    new Set(
      runs
        .filter(
          (r) =>
            r.partner_id &&
            ["sent_to_partner", "in_progress", "completed"].includes(r.status)
        )
        .map((r) => r.partner_id)
    )
  )
  for (const partnerId of partnerIds) {
    await createPartnerOrderLink(container, partnerId as string, unified.id)
  }

  // design↔partner link per (design, committed-partner) pair. WITHOUT this the
  // partner UI's design-details (`GET /partners/designs/:id`, scoped on the
  // design_partner link) 404s "Design not found for this partner" — the
  // "nothing found" the operator sees when opening a design from the collated
  // work-order. Producing a design to a partner IS the assignment, so the link
  // belongs here. Best-effort + idempotent (a re-produce just re-hits it).
  for (const run of runs) {
    if (
      !run.partner_id ||
      !run.design_id ||
      !["sent_to_partner", "in_progress", "completed"].includes(run.status)
    ) {
      continue
    }
    await remoteLink
      .create([
        {
          [DESIGN_MODULE]: { design_id: run.design_id },
          [PARTNER_MODULE]: { partner_id: run.partner_id },
        },
      ])
      .catch((e: any) => {
        // A duplicate (design already assigned to this partner) is fine.
        if (!/duplicate|already exists|unique/i.test(e?.message || "")) {
          logger.warn(
            `[orders-unification] collated design↔partner link failed for design ${run.design_id} / partner ${run.partner_id}: ${e?.message}`
          )
        }
      })
  }

  // Aggregate partner_status onto the sidecar column (best-effort).
  const partnerStatus = aggregatePartnerStatus(runs)
  if (partnerStatus) {
    await setUnifiedOrderPartnerStatus(container, unified.id, partnerStatus).catch(
      (e: any) =>
        logger.warn(
          `[orders-unification] collated sidecar status write failed for ${unified.id}: ${e?.message}`
        )
    )
  }

  return { unified_order_id: unified.id, line_count: items.length }
}

/**
 * How recently a work-order must have been minted to still collect new designs.
 *
 * #1597's wording is "a **recently** minted, still-open order" — a partner sent
 * four designs across a week should get one order, not four. An open order from
 * three months ago is not the same batch of work, and quietly appending to it
 * would make a payout line for today's design land on a claim someone may
 * already be reconciling.
 */
export const WORK_ORDER_COLLATION_WINDOW_DAYS = 14

/**
 * The partner's most recent open collated design work-order, or null (#1597).
 *
 * ⚠️ `collated_design_order` lives in `metadata`, and `query.graph` cannot
 * filter on a JSON subkey — so candidates are narrowed by things that ARE
 * filterable (the partner link, then the order↔run link that IS the kind=design
 * discriminator) and the metadata flag is checked in memory afterwards. A
 * filter written against `metadata.x` would silently match nothing, which here
 * would mean "always mint a new order" — the bug this exists to fix, restored
 * invisibly.
 *
 * 🔴 Read through `PartnerOrderLink.entryPoint`, never by asking the order
 * entity for a linked field: that returns no key at all, silently, and every
 * partner would look like they had no open order.
 *
 * ⚠️ Known limitation, and it fails SAFE. The partner↔order link (D3) is
 * written by `collateRunsIntoWorkOrder` only for partners whose runs reached
 * `sent_to_partner` — i.e. dispatch succeeded for at least one design in the
 * batch. A work-order whose every design failed to dispatch therefore carries
 * no partner link and is invisible here, so the next dispatch mints a fresh
 * order rather than joining it. That is the old behaviour, not a new fault:
 * the cost is an extra order, never a line on the wrong one.
 */
export const findOpenPartnerWorkOrder = async (
  container: MedusaContainer,
  partnerId: string,
  opts: { withinDays?: number } = {}
): Promise<{ order_id: string; created_at: string } | null> => {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (!partnerId) return null

  const withinDays = opts.withinDays ?? WORK_ORDER_COLLATION_WINDOW_DAYS
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000

  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: linkRows } = await query.graph({
      entity: PartnerOrderLink.entryPoint,
      fields: ["order_id"],
      filters: { partner_id: partnerId },
    })
    const orderIds = Array.from(
      new Set(
        (linkRows || [])
          .map((r: any) => r?.order_id)
          .filter(Boolean)
          .map(String)
      )
    )
    if (!orderIds.length) return null

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "status", "created_at", "metadata", "production_runs.id"],
      filters: { id: orderIds },
    })

    const candidates = (orders || [])
      .filter((o: any) => {
        // A design work-order, by the discriminator link — not by metadata.
        const runs = Array.isArray(o?.production_runs)
          ? o.production_runs
          : o?.production_runs
          ? [o.production_runs]
          : []
        if (!runs.length) return false
        // Collated ones only. A per-run order has no room for another design.
        if (o?.metadata?.collated_design_order !== true) return false
        // Open. `completed` and `canceled` are settled; anything else collects.
        if (["completed", "canceled", "cancelled"].includes(String(o?.status ?? ""))) {
          return false
        }
        const created = Date.parse(o?.created_at ?? "")
        return Number.isFinite(created) && created >= cutoff
      })
      .sort(
        (a: any, b: any) =>
          Date.parse(b?.created_at ?? "") - Date.parse(a?.created_at ?? "")
      )

    const chosen = candidates[0]
    return chosen
      ? { order_id: String(chosen.id), created_at: String(chosen.created_at) }
      : null
  } catch (e: any) {
    /**
     * Best-effort: failing to FIND an order must fall back to creating one.
     * The opposite — throwing — would make a lookup hiccup block dispatch
     * entirely, and the dispatch is the thing that matters.
     */
    logger.warn(
      `[orders-unification] open work-order lookup failed for partner ${partnerId}: ${e?.message}`
    )
    return null
  }
}

/**
 * Append runs to an EXISTING collated work-order (#1597).
 *
 * ## Why an order edit and not an insert
 *
 * The partner's order detail renders its line list from the core order's
 * `items`. Linking a run without adding its line would put the run in
 * `production_runs` and nowhere a human can see it — a capability with no
 * screen, which this codebase has shipped before. Core owns `items`, and the
 * only supported way to add one to a placed order is the edit flow:
 * begin → add → confirm.
 *
 * ⚠️ NOT best-effort, unlike its sibling `collateRunsIntoWorkOrder`. A failed
 * projection there leaves the legacy path intact; a failed append here would
 * leave runs dispatched to a partner with no line on any order — invisible
 * work. It throws, and `produceDesignsAsWorkOrder` falls back to minting a
 * fresh order, which is the behaviour that existed before this function.
 */
export const joinRunsIntoWorkOrder = async (
  container: MedusaContainer,
  orderId: string,
  runs: any[]
): Promise<CollatedProjectionResult> => {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const items = buildWorkOrderItems(runs)

  await beginOrderEditOrderWorkflow(container).run({
    input: { order_id: orderId },
  })
  await orderEditAddNewItemWorkflow(container).run({
    input: { order_id: orderId, items: items as any },
  })
  await confirmOrderEditRequestWorkflow(container).run({
    input: { order_id: orderId },
  })

  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  // order↔run for each NEW run. These cannot already exist — the runs were
  // created moments ago — so no existence check is needed here.
  for (const run of runs) {
    await remoteLink
      .create([
        {
          [Modules.ORDER]: { order_id: orderId },
          [PRODUCTION_RUNS_MODULE]: { production_runs_id: run.id },
        },
      ])
      .catch((e: any) =>
        logger.warn(
          `[orders-unification] joined order↔run link failed for run ${run.id}: ${e?.message}`
        )
      )
  }

  /**
   * 🔴 `link.create` is NOT idempotent, and unlike the create path this order
   * already has design and partner links from the designs it collected before.
   * Re-creating them would duplicate rows, so what is already linked is read
   * first and only the genuinely new pairs are written.
   */
  const { data: existingRows } = await query
    .graph({
      entity: "order",
      fields: ["id", "designs.id", "production_runs.id", "metadata"],
      filters: { id: [orderId] },
    })
    .catch(() => ({ data: [] as any[] }))
  const existingOrder = existingRows?.[0]
  const linkedDesignIds = new Set(
    (Array.isArray(existingOrder?.designs)
      ? existingOrder.designs
      : existingOrder?.designs
      ? [existingOrder.designs]
      : []
    )
      .map((d: any) => d?.id)
      .filter(Boolean)
      .map(String)
  )

  const newDesignIds = Array.from(
    new Set(runs.map((r) => r.design_id).filter(Boolean).map(String))
  ).filter((id) => !linkedDesignIds.has(id))

  for (const designId of newDesignIds) {
    await remoteLink
      .create([
        {
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.ORDER]: { order_id: orderId },
        },
      ])
      .catch((e: any) =>
        logger.warn(
          `[orders-unification] joined design link failed for ${designId}: ${e?.message}`
        )
      )
  }

  // design↔partner per (design, committed partner). Idempotent by nature of the
  // create path's own comment ("a re-produce just re-hits it"), and only the
  // designs new to this order are considered.
  for (const run of runs) {
    if (
      !run.partner_id ||
      !run.design_id ||
      !newDesignIds.includes(String(run.design_id)) ||
      !["sent_to_partner", "in_progress", "completed"].includes(run.status)
    ) {
      continue
    }
    await remoteLink
      .create([
        {
          [DESIGN_MODULE]: { design_id: run.design_id },
          [PARTNER_MODULE]: { partner_id: run.partner_id },
        },
      ])
      .catch(() => {})
  }

  /**
   * The order's own record of what it collates, and its rolled-up status —
   * both recomputed across ALL its runs, old and new. A status derived from
   * only the newly-added runs would report a half-finished order as pending.
   */
  const allRunIds = Array.from(
    new Set([
      ...((existingOrder?.metadata?.production_run_ids as string[]) || []),
      ...runs.map((r) => String(r.id)),
    ])
  )

  const runService: ProductionRunService = container.resolve(
    PRODUCTION_RUNS_MODULE
  )
  const allRuns = (await runService
    .listProductionRuns({ id: allRunIds } as any, { select: ["*"] })
    .catch(() => runs)) as any[]

  await patchUnifiedOrder(container, orderId, {
    status: aggregateCoreStatus(allRuns),
    metadata: {
      ...(existingOrder?.metadata || {}),
      production_run_ids: allRunIds,
    },
  })

  const partnerStatus = aggregatePartnerStatus(allRuns)
  if (partnerStatus) {
    await setUnifiedOrderPartnerStatus(container, orderId, partnerStatus).catch(
      (e: any) =>
        logger.warn(
          `[orders-unification] joined sidecar status write failed for ${orderId}: ${e?.message}`
        )
    )
  }

  logger.info(
    `[orders-unification] collated ${runs.length} run(s) into existing work-order ${orderId} (now ${allRunIds.length} run(s))`
  )

  return { unified_order_id: orderId, line_count: items.length }
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
    if (!run) {
      return { linked: false, skipped: "no_unified_order" }
    }

    // D5-3 — resolve the unified order via the order↔production_run link
    // (forward, authoritative); the metadata backref is a transitional fallback
    // for pre-D5-2 link-less runs. The run itself is still read above for the
    // §5 status/lifecycle-timestamp mapping.
    const unifiedOrderId = await resolveUnifiedOrderIdByLink(
      container,
      "production_runs",
      productionRunId
    )
    if (!unifiedOrderId) {
      return { linked: false, skipped: "no_unified_order" }
    }

    // Fetch the order's metadata + ALL its linked runs in one graph read. A
    // COLLATED design work-order (#826) has N runs → 1 order, so its status is
    // the roll-up across every run, not just the one that transitioned; a plain
    // per-run order simply resolves to its own single run.
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orderRows } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "metadata",
        "production_runs.id",
        "production_runs.status",
        "production_runs.accepted_at",
        "production_runs.started_at",
        "production_runs.finished_at",
      ],
      filters: { id: unifiedOrderId },
    })
    const unifiedOrder = orderRows?.[0]

    // A parent order superseded by a run split stays canceled forever — the
    // child orders carry the commercial reality. `superseded_by_run_ids` is the
    // one metadata key still read here; it's write-once at approve, so this is a
    // plain read (PR-H retired the per-order metadata lock — partner_status now
    // lives on the sidecar column, which has no RMW to serialize).
    if (unifiedOrder?.metadata?.superseded_by_run_ids) {
      return { linked: false, skipped: "superseded" }
    }

    // #826 — coreStatus/partnerStatus for a COLLATED order aggregate across all
    // its runs (least-advanced partner_status; completed/canceled only when
    // every run is). A single-run order keeps the exact per-run mapping — the
    // aggregate helpers deliberately don't model the draft/decline nuances the
    // per-run path needs.
    const linkedRuns: any[] = (unifiedOrder?.production_runs ?? []).filter(
      Boolean
    )
    let coreStatus: string | undefined
    let partnerStatus: string | undefined
    if (linkedRuns.length > 1) {
      coreStatus = aggregateCoreStatus(linkedRuns)
      partnerStatus = aggregatePartnerStatus(linkedRuns)
    } else {
      coreStatus = RUN_TO_CORE_STATUS[run.status]
      partnerStatus = deriveRunPartnerStatus(run, opts)
    }

    const orderService: any = container.resolve(Modules.ORDER)

    // core order.status — single-column blind write, no lock.
    if (coreStatus) {
      await orderService.updateOrders([
        { id: unifiedOrderId, status: coreStatus },
      ])
    }

    // PR-H — partner_status is column-only: single-column upsert on the typed
    // sidecar. Throws to the swallow-and-warn boundary on failure.
    if (partnerStatus) {
      await setUnifiedOrderPartnerStatus(container, unifiedOrderId, partnerStatus)
    }

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
        // D5-3 — the parent's unified order via the link (forward,
        // authoritative); metadata backref is the pre-D5-2 fallback.
        const parentOrderId = await resolveUnifiedOrderIdByLink(
          container,
          "production_runs",
          input.parent_run_id
        )
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

      // D5-3 — resolve the unified order via the link (forward, authoritative);
      // the run is still read above for partner_id / execution_mode /
      // sub_partner_id. Metadata backref is the pre-D5-2 fallback.
      const unifiedOrderId = await resolveUnifiedOrderIdByLink(
        container,
        "production_runs",
        input.production_run_id
      )
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

      // PR-H — partner_status is column-only (single-column sidecar upsert), no
      // longer a metadata patch.
      await setUnifiedOrderPartnerStatus(container, unifiedOrderId, "assigned")

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
