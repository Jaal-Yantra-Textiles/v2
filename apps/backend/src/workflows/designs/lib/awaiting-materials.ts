import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"

/**
 * "Your fabric is being made by hand" — which pieces on a design order are
 * waiting for cloth that has not arrived yet.
 *
 * A design order is "like this" when a design on it has a production run held
 * on a supply order (`depends_on_inventory_order_ids`) that is not `Delivered`.
 * That is the same edge the release subscriber reads to start the run, so the
 * email says "waiting on the weaver" exactly while the system is waiting on the
 * weaver — no second rule to drift from the first.
 *
 * 🔑 `Delivered` is the release point everywhere else (see the run tools): a
 * `Shipped` order is cloth in a van, still not at the bench, so it still counts
 * as waiting here.
 */

export type AwaitingMaterialsLine = {
  /** The piece as the buyer's order names it. */
  design: string
  /** Who is weaving the cloth, e.g. "Shramdaan". De-duplicated, in order. */
  suppliers: string[]
  /** Who stitches it once the cloth lands, e.g. "Prince Tailors". */
  maker: string | null
}

type PlanInput = {
  designs: Array<{ id: string; title: string }>
  runs: Array<{
    design_id: string | null
    status: string | null
    partner_name: string | null
    depends_on_inventory_order_ids: string[] | null
  }>
  orders: Array<{ id: string; status: string | null; supplier_name: string | null }>
}

/** Statuses at which a run has not started and can still be waiting on goods. */
const WAITING_RUN_STATUSES = new Set(["approved", "pending_review", "draft"])

/** PURE: the lines the email lists. Empty means the order is not "like this". */
export const planAwaitingMaterials = (input: PlanInput): AwaitingMaterialsLine[] => {
  const orderById = new Map(input.orders.map((o) => [o.id, o]))
  const lines: AwaitingMaterialsLine[] = []

  for (const design of input.designs) {
    const suppliers: string[] = []
    let maker: string | null = null

    for (const run of input.runs) {
      if (run.design_id !== design.id) continue
      if (!WAITING_RUN_STATUSES.has(String(run.status ?? ""))) continue

      const open = (run.depends_on_inventory_order_ids ?? [])
        .map((id) => orderById.get(id))
        .filter((o): o is NonNullable<typeof o> => Boolean(o) && o!.status !== "Delivered" && o!.status !== "Cancelled")
      if (!open.length) continue

      for (const o of open) {
        const name = (o.supplier_name ?? "").trim()
        if (name && !suppliers.includes(name)) suppliers.push(name)
      }
      maker = maker ?? ((run.partner_name ?? "").trim() || null)
    }

    if (suppliers.length || maker) {
      lines.push({ design: design.title, suppliers, maker })
    }
  }

  return lines
}

/**
 * Read what `planAwaitingMaterials` needs for a cart's designs. Never throws:
 * a failed read means the email goes out without the section, which is the
 * email every other order gets — not a reason to withhold the checkout link.
 */
export const loadAwaitingMaterials = async (
  scope: any,
  designs: Array<{ id: string; title: string }>
): Promise<AwaitingMaterialsLine[]> => {
  if (!designs.length) return []
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
    const runService: any = scope.resolve(PRODUCTION_RUNS_MODULE)

    const runs: any[] =
      (await runService.listProductionRuns({ design_id: designs.map((d) => d.id) })) ?? []
    const waiting = runs.filter(
      (r) =>
        WAITING_RUN_STATUSES.has(String(r?.status ?? "")) &&
        Array.isArray(r?.depends_on_inventory_order_ids) &&
        r.depends_on_inventory_order_ids.length > 0
    )
    if (!waiting.length) return []

    const orderIds = [...new Set(waiting.flatMap((r) => r.depends_on_inventory_order_ids as string[]))]
    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: ["id", "status", "partner.name"],
      filters: { id: orderIds },
    })

    const partnerIds = [...new Set(waiting.map((r) => r.partner_id).filter(Boolean))]
    const { data: partners } = partnerIds.length
      ? await query.graph({ entity: "partners", fields: ["id", "name"], filters: { id: partnerIds } })
      : { data: [] }
    const partnerName = new Map((partners ?? []).map((p: any) => [p.id, p.name]))

    return planAwaitingMaterials({
      designs,
      runs: waiting.map((r) => ({
        design_id: r.design_id ?? null,
        status: r.status ?? null,
        partner_name: (partnerName.get(r.partner_id) as string) ?? null,
        depends_on_inventory_order_ids: r.depends_on_inventory_order_ids,
      })),
      orders: (orders ?? []).map((o: any) => ({
        id: o.id,
        status: o.status ?? null,
        // The link is a list on the partner side; one supplier per order here.
        supplier_name: (Array.isArray(o.partner) ? o.partner[0]?.name : o.partner?.name) ?? null,
      })),
    })
  } catch (e: any) {
    logger?.warn?.(`[design-order] awaiting-materials lookup failed: ${e?.message ?? e}`)
    return []
  }
}
