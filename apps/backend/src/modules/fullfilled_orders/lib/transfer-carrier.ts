/**
 * The carrier facts behind a goods transfer (#1553, closing part of #891).
 *
 * 🔴 You can book a real, billable waybill from the production run page and
 * then never see the AWB again. It is shown exactly once, in a toast, at the
 * moment of booking — dismiss it and the number is gone from every surface. The
 * operator's next question, *"has it been picked up?"*, has no answer on the
 * screen they are on precisely because the goods moved.
 *
 * The data was never missing. `goods_transfer.shipment_id` has pointed at the
 * `inventory_shipment` row carrying the AWB, label and tracking status since
 * #891 — `shipment_id` is a plain column rather than a relation, deliberately,
 * so adding transfers did not migrate the live shipment table. The cost of that
 * choice is that nothing hydrates it: both transfer routes returned raw rows,
 * so the carrier never left the server and the client could not have rendered
 * it if it wanted to.
 *
 * PURE, so the one judgement here — what an unresolvable `shipment_id` means —
 * is testable without a database.
 */

export type ShipmentLike = {
  id: string
  carrier?: string | null
  awb?: string | null
  tracking_number?: string | null
  tracking_url?: string | null
  label_url?: string | null
  status?: string | null
  pickup_location_name?: string | null
  pickup_scheduled_date?: string | null
}

export type TransferLike = {
  id: string
  shipment_id?: string | null
  [key: string]: any
}

/**
 * Whether a carrier was booked for this hop — and, crucially, whether we can
 * still see it.
 *
 * 🔴 Three states, not two. `not_booked` and `unresolved` both present as "no
 * carrier facts to show", and collapsing them is how a screen tells an operator
 * *nobody booked this* when the truth is *a waybill exists and I cannot find
 * it*. That is #1621's shape, and here it would send someone to re-book a hop
 * the carrier has already collected.
 *
 * - `not_booked`  — `shipment_id` is null. A van run between two of our own
 *                   locations is a real transfer with no AWB, and this is the
 *                   correct, final answer for it.
 * - `booked`      — the shipment row was found. Its facts are attached.
 * - `unresolved`  — `shipment_id` names a row we could not read. Say so.
 */
export type TransferCarrierState = "not_booked" | "booked" | "unresolved"

export type TransferCarrier = {
  shipment_id: string
  carrier: string | null
  awb: string | null
  tracking_number: string | null
  tracking_url: string | null
  label_url: string | null
  status: string | null
  pickup_location_name: string | null
  pickup_scheduled_date: string | null
}

export type HydratedTransfer = TransferLike & {
  carrier_state: TransferCarrierState
  /** Null unless `carrier_state` is `booked`. Never a partially-filled shell. */
  shipment: TransferCarrier | null
}

/**
 * Attach each transfer's shipment to it.
 *
 * ⚠️ Only the carrier-facing fields are copied across, not the whole shipment
 * row. `provider_refs` and `metadata` carry raw carrier payloads that can
 * include account identifiers, and a transfer list on a partner screen is not
 * the place to widen what leaves the server.
 */
export const attachCarrierToTransfers = (
  transfers: TransferLike[],
  shipments: ShipmentLike[]
): HydratedTransfer[] => {
  const byId = new Map(shipments.map((s) => [s.id, s]))

  return transfers.map((transfer) => {
    if (!transfer.shipment_id) {
      return { ...transfer, carrier_state: "not_booked", shipment: null }
    }

    const shipment = byId.get(transfer.shipment_id)
    if (!shipment) {
      return { ...transfer, carrier_state: "unresolved", shipment: null }
    }

    return {
      ...transfer,
      carrier_state: "booked",
      shipment: {
        shipment_id: shipment.id,
        carrier: shipment.carrier ?? null,
        awb: shipment.awb ?? null,
        tracking_number: shipment.tracking_number ?? null,
        tracking_url: shipment.tracking_url ?? null,
        label_url: shipment.label_url ?? null,
        status: shipment.status ?? null,
        pickup_location_name: shipment.pickup_location_name ?? null,
        pickup_scheduled_date: shipment.pickup_scheduled_date ?? null,
      },
    }
  })
}

/**
 * A run's transfers, carrier facts included — the shape both the admin and the
 * partner route return.
 *
 * ⚠️ The shipment read is best-effort. A hop the operator can SEE, minus its
 * AWB, is worth more than a 500 on the panel that was going to show it — but
 * the loss is stated as `unresolved` rather than silently rendered as an
 * un-booked movement.
 */
export const listRunTransfersWithCarrier = async (
  service: any,
  productionRunId: string
): Promise<HydratedTransfer[]> => {
  const transfers: TransferLike[] = await service.listGoodsTransfers(
    { production_run_id: productionRunId },
    { order: { created_at: "DESC" } }
  )

  const shipmentIds = Array.from(
    new Set(transfers.map((t) => t.shipment_id).filter(Boolean))
  ) as string[]

  if (!shipmentIds.length) {
    return attachCarrierToTransfers(transfers, [])
  }

  let shipments: ShipmentLike[] = []
  try {
    shipments = await service.listInventoryShipments({ id: shipmentIds })
  } catch {
    shipments = []
  }

  return attachCarrierToTransfers(transfers, shipments)
}
