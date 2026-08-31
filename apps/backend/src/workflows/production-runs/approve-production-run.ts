import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import type { LinkDefinition } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

import { PRODUCTION_POLICY_MODULE } from "../../modules/production_policy"
import type ProductionPolicyService from "../../modules/production_policy/service"

import { DESIGN_MODULE } from "../../modules/designs"
import { PARTNER_MODULE } from "../../modules/partner"
import designPartnersLink from "../../links/design-partners-link"
import { dualWriteChildRunOrdersStep } from "./dual-write-unified-run-order"
import DesignInventoryLink from "../../links/design-inventory-link"
import {
  normalizeRunMaterials,
  type NormalizedRunMaterial,
  type RunMaterialInput,
} from "./lib/run-materials"

export type ProductionRunAssignment = {
  partner_id: string
  role?: string | null
  /**
   * Units for this child. Absent inherits the parent's; explicit `null`
   * declares this child open-ended — no agreed quantity, no payment ceiling
   * (#1676).
   */
  quantity?: number | null
  order?: number
  /**
   * Templates BY NAME. Kept because existing callers use it, but since #1261 a
   * name may identify nothing — dispatch REFUSES one that matches more than one
   * template, so an approval recorded this way can become uncarryable.
   */
  template_names?: string[]
  /** Templates BY ID — preferred. Wins over `template_names` when both are sent. */
  template_ids?: string[]
  /**
   * The materials THIS partner is being sent: a subset of the design's bill of
   * materials, with the quantity issued to them.
   *
   * Omit and the assignment behaves exactly as it always has — the child run
   * carries the whole design BOM and the partner is asked to account for all of
   * it. That was the only available behaviour before this field existed, which
   * is why absence has to keep meaning "unconstrained" rather than "nothing".
   */
  materials?: RunMaterialInput[]
  /**
   * Inventory orders this partner's stage waits on (#1529) — the goods being
   * supplied to them before they can start.
   *
   * This is what lets a chain OPEN with a supplier rather than a maker: the
   * weaver is sent an inventory order, and the partner who works that cloth
   * names it here. The stage stays undispatchable until every one of them
   * reaches `Delivered`, and is then released automatically.
   *
   * Independent of `order`: a stage may wait on goods, on the previous stage,
   * or on both, and the two edges are checked together.
   */
  depends_on_inventory_order_ids?: string[]
}

export type ApproveProductionRunInput = {
  production_run_id: string
  assignments?: ProductionRunAssignment[]
}

const retrieveProductionRunStep = createStep(
  "retrieve-production-run",
  async (input: { production_run_id: string }, { container }) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const run = await productionRunService.retrieveProductionRun(input.production_run_id)

    return new StepResponse(run)
  }
)

const approveProductionRunStep = createStep(
  "approve-production-run",
  async (
    input: { production_run_id: string; assignments: ProductionRunAssignment[] },
    { container }
  ) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const productionPolicyService: ProductionPolicyService = container.resolve(
      PRODUCTION_POLICY_MODULE
    )

    const original = await productionRunService.retrieveProductionRun(input.production_run_id)

    if (!original) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductionRun ${input.production_run_id} not found`
      )
    }

    await productionPolicyService.assertCanApprove(original as any)

    // Validate every assignment's material allocation BEFORE anything is
    // written. An invalid `materials` array must be a no-op, not a parent left
    // flipped to `approved` with no children to show for it (#1358's shape:
    // the rejection that is a corruption because the write already happened).
    const requestedAssignments = input.assignments || []
    const wantsMaterials = requestedAssignments.some((a) => a.materials?.length)
    let bomItemIds: string[] | null = null
    if (wantsMaterials && (original as any).design_id) {
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: bomRows } = await query.graph({
        entity: DesignInventoryLink.entryPoint,
        fields: ["inventory_item_id"],
        filters: { design_id: (original as any).design_id },
      })
      bomItemIds = (bomRows || [])
        .map((r: any) => r.inventory_item_id)
        .filter(Boolean)
    }

    const allocationByIndex: NormalizedRunMaterial[][] = requestedAssignments.map(
      (a, idx) => {
        const normalized = normalizeRunMaterials(a.materials, bomItemIds)
        if (!normalized.ok) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `assignment ${idx} (partner ${a.partner_id}): ${normalized.error}`
          )
        }
        return normalized.materials
      }
    )

    const updatedParent = await productionRunService.updateProductionRuns({
      id: original.id,
      status: "approved" as any,
    })

    const assignments = input.assignments || []
    if (!assignments.length) {
      return new StepResponse(
        { parent: updatedParent, children: [] },
        { parentOriginal: original, childIds: [] as string[] }
      )
    }

    // Children must NOT inherit the parent's #342 unified-order backref —
    // each child is its own commercial unit (§4) and gets its own projected
    // order. Leaving `unified_order_id` in the copied metadata would make the
    // projection's idempotency guard reuse the parent's (soon-superseded)
    // order for every child.
    const { unified_order_id: _omitParentOrderRef, ...inheritedMetadata } =
      ((original as any).metadata ?? {}) as Record<string, any>

    const childPayloads = assignments.map((a, idx) => {
      /**
       * A child inherits the parent's OPEN-ENDEDNESS, not just its number
       * (#1676). `a.quantity ?? parent.quantity ?? 1` collapsed a parent with
       * no agreed quantity to 1 — the tightest possible payment ceiling on a
       * run whose whole point is that it has none, and the sort of inversion
       * that only shows up when a partner's claim is refused.
       *
       * An assignment that states its own quantity still wins — including an
       * explicit `null`, which declares that one child open-ended even when the
       * parent is not. Hence `!== undefined` rather than `!= null`.
       */
      const parentQuantity = (original as any).quantity
      const quantity =
        a.quantity !== undefined
          ? a.quantity
          : parentQuantity === null
            ? null
            : parentQuantity ?? 1
      const allocation = allocationByIndex[idx] || []

      const originalSnapshot = (original as any).snapshot
      // Narrow the child's snapshot to what this partner is actually getting.
      // The parent still carries the full BOM — it is the design's plan; the
      // child carries the issue list, which is a different fact.
      const parentLinks: any[] = Array.isArray(originalSnapshot?.inventory_links)
        ? originalSnapshot.inventory_links
        : []
      const parentLinkById = new Map(
        parentLinks.map((l: any) => [l.inventory_item_id, l])
      )
      const narrowedLinks = allocation.length
        ? allocation.map((m) => {
            const base: any = parentLinkById.get(m.inventory_item_id) || {}
            return {
              ...base,
              inventory_item_id: m.inventory_item_id,
              planned_quantity: m.planned_quantity ?? base.planned_quantity ?? null,
              location_id: m.location_id ?? base.location_id ?? null,
              resolved_raw_material_id: m.resolved_raw_material_id ?? null,
              metadata: { ...(base.metadata || {}), ...(m.metadata || {}) },
            }
          })
        : parentLinks

      const snapshot = originalSnapshot
        ? {
            ...originalSnapshot,
            inventory_links: narrowedLinks,
            provenance: {
              ...(originalSnapshot as any).provenance,
              partner_id: a.partner_id,
              quantity,
            },
          }
        : originalSnapshot

      return {
        parent_run_id: original.id,
        role: a.role ?? null,
        design_id: (original as any).design_id,
        partner_id: a.partner_id,
        quantity,
        product_id: (original as any).product_id ?? null,
        variant_id: (original as any).variant_id ?? null,
        order_id: (original as any).order_id ?? null,
        order_line_item_id: (original as any).order_line_item_id ?? null,
        snapshot,
        captured_at: (original as any).captured_at,
        status: "approved" as any,
        run_type: (original as any).run_type ?? "production",
        // Both are recorded as sent. The ids are what dispatch should act on;
        // the names stay so an older reader still sees what was asked for.
        dispatch_template_names: a.template_names?.length ? a.template_names : null,
        dispatch_template_ids: a.template_ids?.length ? a.template_ids : null,
        depends_on_inventory_order_ids: a.depends_on_inventory_order_ids?.length
          ? a.depends_on_inventory_order_ids
          : null,
        metadata: Object.keys(inheritedMetadata).length ? inheritedMetadata : null,
      }
    })

    const createdChildren = await productionRunService.createProductionRuns(childPayloads as any)
    const children = Array.isArray(createdChildren) ? createdChildren : [createdChildren]

    const childIds = children.map((c: any) => c.id).filter(Boolean)

    // The authoritative allocation. Written after the children exist (it needs
    // their ids) but validated long before — see above.
    const allocationLinks: LinkDefinition[] = []
    for (let i = 0; i < children.length; i++) {
      const childId = (children[i] as any)?.id
      const allocation = allocationByIndex[i] || []
      if (!childId || !allocation.length) continue
      for (const m of allocation) {
        allocationLinks.push({
          [PRODUCTION_RUNS_MODULE]: { production_runs_id: childId },
          [Modules.INVENTORY]: { inventory_item_id: m.inventory_item_id },
          data: {
            planned_quantity: m.planned_quantity,
            location_id: m.location_id,
            resolved_raw_material_id: m.resolved_raw_material_id,
            note: m.note,
            metadata: m.metadata,
          },
        })
      }
    }
    if (allocationLinks.length) {
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
      await remoteLink.create(allocationLinks)
    }

    // Compute depends_on_run_ids based on assignment order
    const hasOrdering = assignments.some((a) => a.order != null)
    if (hasOrdering && children.length === assignments.length) {
      // Group children by their assignment order
      const orderToChildIds = new Map<number, string[]>()
      for (let i = 0; i < assignments.length; i++) {
        const order = assignments[i].order ?? 0
        const childId = (children[i] as any)?.id
        if (!childId) continue
        if (!orderToChildIds.has(order)) {
          orderToChildIds.set(order, [])
        }
        orderToChildIds.get(order)!.push(childId)
      }

      const sortedOrders = Array.from(orderToChildIds.keys()).sort((a, b) => a - b)

      for (let i = 1; i < sortedOrders.length; i++) {
        const prevOrder = sortedOrders[i - 1]
        const currentOrder = sortedOrders[i]
        const dependencyIds = orderToChildIds.get(prevOrder) || []
        const currentChildIds = orderToChildIds.get(currentOrder) || []

        for (const childId of currentChildIds) {
          await productionRunService.updateProductionRuns({
            id: childId,
            depends_on_run_ids: dependencyIds,
          } as any)
        }
      }

      // Refresh children to include updated depends_on_run_ids
      const refreshedChildren = await Promise.all(
        childIds.map((id: string) => productionRunService.retrieveProductionRun(id))
      )

      return new StepResponse(
        { parent: updatedParent, children: refreshedChildren },
        { parentOriginal: original, childIds, allocationLinks }
      )
    }

    return new StepResponse(
      { parent: updatedParent, children },
      { parentOriginal: original, childIds, allocationLinks }
    )
  },
  async (
    rollbackData:
      | {
          parentOriginal: any
          childIds: string[]
          allocationLinks?: LinkDefinition[]
        }
      | undefined,
    { container }
  ) => {
    if (!rollbackData) {
      return
    }

    if (rollbackData.allocationLinks?.length) {
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
      await remoteLink.dismiss(rollbackData.allocationLinks)
    }

    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    if (rollbackData.childIds?.length) {
      await productionRunService.softDeleteProductionRuns(rollbackData.childIds as any)
    }

    if (rollbackData.parentOriginal?.id) {
      await productionRunService.updateProductionRuns({
        id: rollbackData.parentOriginal.id,
        status: rollbackData.parentOriginal.status,
      })
    }
  }
)

/**
 * Roadmap item 27 — when an admin assigns a production run to a
 * partner, that partner should also appear in the design's
 * `design_partners_link` so the design surfaces in the partner's
 * `/partners/designs` listing. The path was previously additive in
 * intent but only the production-run side got updated, leaving
 * /partners/designs blind to assignments that came in via this
 * workflow. Re-using `designPartnersLink.entryPoint` keeps the
 * idempotency check cheap and avoids duplicate rows.
 */
const linkDesignToPartnersStep = createStep(
  "link-design-to-partners",
  async (
    input: { design_id: string | null; partner_ids: string[] },
    { container }
  ) => {
    if (!input.design_id || !input.partner_ids.length) {
      return new StepResponse({ created: 0, already_linked: 0 }, [])
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as any

    // Existing links for this design — used to skip already-linked pairs.
    // Querying once and filtering in memory is cheaper than N round trips
    // when an admin assigns to many partners at once.
    const { data: existing } = await query.graph({
      entity: designPartnersLink.entryPoint,
      filters: { design_id: input.design_id },
      fields: ["partner_id"],
    })
    const linkedPartnerIds = new Set<string>(
      (existing ?? []).map((l: any) => l.partner_id).filter(Boolean)
    )

    const toCreate: LinkDefinition[] = []
    let alreadyLinked = 0
    for (const partnerId of input.partner_ids) {
      if (!partnerId) continue
      if (linkedPartnerIds.has(partnerId)) {
        alreadyLinked++
        continue
      }
      toCreate.push({
        [DESIGN_MODULE]: { design_id: input.design_id },
        [PARTNER_MODULE]: { partner_id: partnerId },
      })
      // Track in the local set so duplicate partner_ids in the same
      // assignments array don't push two link entries.
      linkedPartnerIds.add(partnerId)
    }

    if (toCreate.length) {
      await remoteLink.create(toCreate)
    }

    return new StepResponse(
      { created: toCreate.length, already_linked: alreadyLinked },
      toCreate
    )
  },
  async (links: LinkDefinition[] | undefined, { container }) => {
    if (!links?.length) return
    const remoteLink: any = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as any
    await remoteLink.dismiss(links)
  }
)

export const approveProductionRunWorkflow = createWorkflow(
  "approve-production-run",
  (input: ApproveProductionRunInput) => {
    const run = retrieveProductionRunStep({ production_run_id: input.production_run_id })

    const assignments = transform({ input, run }, (data) => {
      const provided = data.input.assignments || []

      if (provided.length) {
        return provided
      }

      const partnerId = (data.run as any)?.partner_id
      if (partnerId) {
        // ⚠️ `=== undefined`, not `??`: a run with NO agreed quantity (#1676)
        // stays open-ended in its implied single assignment. `?? 1` would have
        // capped it at one piece.
        const runQuantity = (data.run as any)?.quantity
        return [
          {
            partner_id: partnerId,
            quantity: runQuantity === undefined ? 1 : runQuantity,
          },
        ]
      }

      return []
    })

    const approved = approveProductionRunStep({
      production_run_id: input.production_run_id,
      assignments,
    })

    // After child runs land, mirror the (design, partner) edges into
    // `design_partners_link` so the partners-side `/partners/designs`
    // surface picks them up. Compensation rolls the link rows we
    // created (idempotent — already-linked pairs are no-ops on both
    // create and rollback).
    const designPartnerLinkInput = transform({ run, assignments }, (data) => ({
      design_id: ((data.run as any)?.design_id as string | null) ?? null,
      partner_ids: ((data.assignments as any[]) ?? [])
        .map((a) => a?.partner_id as string | undefined)
        .filter((id): id is string => !!id),
    }))
    linkDesignToPartnersStep(designPartnerLinkInput)

    // #342 — child runs are the partner-facing unit (§4): each gets its own
    // kind=design order; a split parent's order is canceled as superseded.
    const childOrderInput = transform({ input, approved }, (data) => ({
      parent_run_id: data.input.production_run_id,
      child_run_ids: ((data.approved as any)?.children ?? [])
        .map((c: any) => c?.id)
        .filter(Boolean),
    }))
    dualWriteChildRunOrdersStep(childOrderInput)

    return new WorkflowResponse(approved)
  }
)
