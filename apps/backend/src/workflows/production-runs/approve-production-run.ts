import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import type { LinkDefinition } from "@medusajs/framework/types"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

import { PRODUCTION_POLICY_MODULE } from "../../modules/production_policy"
import type ProductionPolicyService from "../../modules/production_policy/service"

import { DESIGN_MODULE } from "../../modules/designs"
import { PARTNER_MODULE } from "../../modules/partner"
import designPartnersLink from "../../links/design-partners-link"

export type ProductionRunAssignment = {
  partner_id: string
  role?: string | null
  quantity?: number
  order?: number
  template_names?: string[]
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

    const childPayloads = assignments.map((a) => {
      const quantity = a.quantity ?? (original as any).quantity ?? 1

      const originalSnapshot = (original as any).snapshot
      const snapshot = originalSnapshot
        ? {
            ...originalSnapshot,
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
        dispatch_template_names: a.template_names?.length ? a.template_names : null,
        metadata: (original as any).metadata ?? null,
      }
    })

    const createdChildren = await productionRunService.createProductionRuns(childPayloads as any)
    const children = Array.isArray(createdChildren) ? createdChildren : [createdChildren]

    const childIds = children.map((c: any) => c.id).filter(Boolean)

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
        { parentOriginal: original, childIds }
      )
    }

    return new StepResponse(
      { parent: updatedParent, children },
      { parentOriginal: original, childIds }
    )
  },
  async (
    rollbackData: { parentOriginal: any; childIds: string[] } | undefined,
    { container }
  ) => {
    if (!rollbackData) {
      return
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

// Re-assigning a partner via a production run supersedes any prior
// cancellation of that design's partner assignment. The legacy cancel
// marker (`design.metadata.partner_assignment_cancelled_at`) otherwise
// pins `partner_status` to "cancelled" forever — even after a new run is
// created and completed — because the partner_status derivation
// short-circuits on the flag (see /partners/designs/[designId]/route.ts).
// Clear it here so the design reflects the new assignment.
type ClearCancelMarkerComp = {
  design_id: string
  prev: {
    partner_assignment_cancelled_at: string | null
    partner_assignment_cancelled_partner_id: string | null
  }
}

const clearDesignCancelMarkerStep = createStep(
  "clear-design-cancel-marker",
  async (
    input: { design_id: string | null; partner_ids: string[] },
    { container }
  ) => {
    if (!input.design_id || !input.partner_ids.length) {
      return new StepResponse<{ cleared: boolean }, ClearCancelMarkerComp>({ cleared: false })
    }
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const designService: any = container.resolve(DESIGN_MODULE)

    const { data } = await query.graph({
      entity: "design",
      filters: { id: input.design_id },
      fields: ["id", "metadata"],
    })
    const meta = (data?.[0]?.metadata as Record<string, any>) || {}
    if (
      meta.partner_assignment_cancelled_at == null &&
      meta.partner_assignment_cancelled_partner_id == null
    ) {
      // Nothing to clear — skip the write (and the compensation no-ops).
      return new StepResponse<{ cleared: boolean }, ClearCancelMarkerComp>({ cleared: false })
    }

    const prev = {
      partner_assignment_cancelled_at: meta.partner_assignment_cancelled_at ?? null,
      partner_assignment_cancelled_partner_id:
        meta.partner_assignment_cancelled_partner_id ?? null,
    }
    // Medusa merges metadata on update, so omitting keys won't remove
    // them — set to null (Medusa's metadata-deletion convention).
    await designService.updateDesigns({
      id: input.design_id,
      metadata: {
        partner_assignment_cancelled_at: null,
        partner_assignment_cancelled_partner_id: null,
      },
    })
    return new StepResponse<{ cleared: boolean }, ClearCancelMarkerComp>(
      { cleared: true },
      { design_id: input.design_id, prev }
    )
  },
  async (compensation: ClearCancelMarkerComp | undefined, { container }) => {
    if (!compensation?.design_id) return
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const designService: any = container.resolve(DESIGN_MODULE)
    const { data } = await query.graph({
      entity: "design",
      filters: { id: compensation.design_id },
      fields: ["id", "metadata"],
    })
    const meta = (data?.[0]?.metadata as Record<string, any>) || {}
    await designService.updateDesigns({
      id: compensation.design_id,
      metadata: { ...meta, ...compensation.prev },
    })
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
        return [{ partner_id: partnerId, quantity: (data.run as any)?.quantity ?? 1 }]
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

    // Clear any stale partner-assignment cancellation marker — this run
    // is a fresh (re)assignment for the design's partner(s).
    clearDesignCancelMarkerStep(designPartnerLinkInput)

    return new WorkflowResponse(approved)
  }
)
