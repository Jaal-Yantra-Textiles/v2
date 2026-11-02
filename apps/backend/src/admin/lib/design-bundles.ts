/**
 * Design bundles = collated design work orders.
 *
 * "Send these designs to a partner together" already exists: the Collate
 * wizard / `produce_designs` makes one run per design and collates them into
 * ONE work order (`kind=design`, `collation=collated`). GET
 * /admin/design-work-orders returns those orders with their runs plus a
 * design and partner lookup. This turns that response into the rows of a
 * collapsible tree: one row per bundle, one child row per design in it.
 */

export type BundleRun = {
  id: string
  design_id?: string | null
  partner_id?: string | null
  status?: string | null
  quantity?: number | null
}

export type BundleOrder = {
  id: string
  display_id?: number | null
  status?: string | null
  created_at?: string | null
  partner_status?: string | null
  runs?: BundleRun[]
}

export type BundleDesignRow = {
  kind: "design"
  id: string
  design_id: string
  name: string
  design_status: string | null
  run_id: string
  run_status: string | null
  quantity: number
}

export type BundleRow = {
  kind: "bundle"
  id: string
  order_id: string
  label: string
  partner: string
  created_at: string | null
  status: string | null
  design_count: number
  pieces: number
  children: BundleDesignRow[]
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/**
 * Newest bundle first. A bundle with runs for more than one partner names all
 * of them; a run whose design is missing from the lookup still shows, by id,
 * so a count never disagrees with the rows under it.
 */
export const buildBundleRows = (
  orders: BundleOrder[],
  designs: Record<string, { name?: string | null; status?: string | null }>,
  partners: Record<string, string>
): BundleRow[] =>
  [...orders]
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .map((order) => {
      const runs = order.runs ?? []
      const children: BundleDesignRow[] = runs.map((run) => {
        const designId = run.design_id ?? ""
        const design = designs[designId]
        return {
          kind: "design",
          id: `${order.id}/${run.id}`,
          design_id: designId,
          name: design?.name?.trim() || designId || "Unknown design",
          design_status: design?.status ?? null,
          run_id: run.id,
          run_status: run.status ?? null,
          quantity: num(run.quantity),
        }
      })
      const partnerNames = [
        ...new Set(runs.map((r) => (r.partner_id ? partners[r.partner_id] ?? r.partner_id : null)).filter(Boolean)),
      ] as string[]
      return {
        kind: "bundle",
        id: order.id,
        order_id: order.id,
        label: order.display_id != null ? `Order #${order.display_id}` : order.id,
        partner: partnerNames.join(", ") || "No partner",
        created_at: order.created_at ?? null,
        status: order.partner_status ?? order.status ?? null,
        design_count: children.length,
        pieces: children.reduce((sum, c) => sum + c.quantity, 0),
        children,
      }
    })
