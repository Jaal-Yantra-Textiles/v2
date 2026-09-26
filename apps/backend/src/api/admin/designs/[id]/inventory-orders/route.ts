import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import designInventoryOrderLink from "../../../../../links/design-inventory-order"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders"

/**
 * The material a design is waiting for (#2111).
 *
 * GET  /admin/designs/:id/inventory-orders — what is on its way, and its status.
 * POST /admin/designs/:id/inventory-orders — attach an order to this design.
 *
 * Attaching is what makes the arrival tellable: the subscriber on the inventory
 * order's status change walks this edge to find whose design the cloth was for.
 * Without it the only path is `run.depends_on_inventory_order_ids` →
 * `run.design_id`, which exactly 1 of 146 runs on prod can follow, and which no
 * design without a run can follow at all.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const designId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: links = [] } = await query
    .graph({
      entity: designInventoryOrderLink.entryPoint,
      filters: { design_id: designId },
      fields: [
        "design_id",
        "inventory_orders_id",
        "notify_customer",
        "notified_at",
        "note",
      ],
    })
    .catch(() => ({ data: [] }))

  const orderIds = (links as any[])
    .map((l) => l?.inventory_orders_id)
    .filter(Boolean)

  /*
   * 🔴 The orders are fetched as RECORDS, never counted off the link rows. A
   * link row is not a record: a partner's `people` node once read "4 linked"
   * against four person ids that no longer existed.
   */
  const { data: orders = [] } = orderIds.length
    ? await query.graph({
        entity: "inventory_orders",
        filters: { id: orderIds },
        fields: [
          "id",
          "status",
          "quantity",
          "total_price",
          "currency_code",
          "expected_delivery_date",
          // Who supplies it — the approve form matches this against the
          // design's supplier-role partners (#2306 S2).
          "partner.id",
          "partner.name",
        ],
      })
    : { data: [] }

  const byId = new Map((orders as any[]).map((o) => [String(o.id), o]))

  res.json({
    design_inventory_orders: (links as any[])
      .filter((l) => byId.has(String(l.inventory_orders_id)))
      .map((l) => ({
        ...byId.get(String(l.inventory_orders_id)),
        notify_customer: l.notify_customer !== false,
        notified_at: l.notified_at ?? null,
        note: l.note ?? null,
      })),
  })
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const designId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  /*
   * `validatedBody` — the route is bound to `AttachDesignInventoryOrderSchema`,
   * which also coerces the MCP surface's "true"/"false" STRINGS into booleans
   * before `!== false` ever sees them.
   */
  const body = req.validatedBody as {
    inventory_order_id: string
    notify_customer?: boolean
    note?: string | null
  }
  const orderId = body.inventory_order_id.trim()

  const [{ data: designs }, { data: orders }] = await Promise.all([
    query.graph({ entity: "design", filters: { id: designId }, fields: ["id", "name"] }),
    query.graph({
      entity: "inventory_orders",
      filters: { id: orderId },
      fields: ["id", "status"],
    }),
  ])

  if (!designs?.length) {
    res.status(404).json({ message: `Design ${designId} was not found` })
    return
  }
  if (!orders?.length) {
    res.status(404).json({ message: `Inventory order ${orderId} was not found` })
    return
  }

  await remoteLink.create([
    {
      [DESIGN_MODULE]: { design_id: designId },
      [ORDER_INVENTORY_MODULE]: { inventory_orders_id: orderId },
      data: {
        /*
         * Only an explicit `false` suppresses. An omitted flag means the caller
         * expressed no opinion, and the sending default is the safe one — an
         * attachment exists because somebody said this cloth is for this
         * design, and the common case is that the client should know.
         */
        notify_customer: body.notify_customer !== false,
        note: typeof body.note === "string" ? body.note : null,
      },
    },
  ])

  res.status(200).json({
    design_inventory_order: {
      design_id: designId,
      inventory_order_id: orderId,
      status: orders[0].status,
      notify_customer: body.notify_customer !== false,
      /*
       * 🔴 Says plainly that attaching sends nothing NOW. An order already
       * Delivered when it is attached has no further status change to fire on,
       * so the client hears about it only if somebody sends it by hand.
       */
      notified: false,
    },
  })
}
