import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"
import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"
import { ensureCarrierPickup } from "../../modules/shipping-providers/carrier-pickups"
import { resolvePlatformTaxIdForCountry } from "../../modules/shipping-providers/seller-tax-id"
import { describeIntlPrereqError } from "../../modules/shipping-providers/shiprocket/client"
import type { Dimensions } from "../../modules/shipping-providers/provider-interface"
import {
  missingDestinationAddressFields,
  normalizeDimensionsCm,
  resolveInventoryDestinationAddress,
} from "../inventory_orders/lib/inventory-order-shipment"
import {
  buildTransferShipmentInput,
  transferQuantity,
} from "./lib/goods-transfer-shipment"

/**
 * #891 — move a production run's output from where it was made to wherever it
 * needs to go next (a finishing partner, a QC/packaging warehouse, or stock).
 *
 * Reuses the shipment machinery wholesale: `resolveShippingProvider` (so both
 * Shiprocket and Delhivery work here on day one), `ensureCarrierPickup`
 * for the origin, `resolveInventoryDestinationAddress` for the destination, and
 * an `inventory_shipment` row for the carrier refs so the existing tracking
 * webhook needs no new routing. What's new is only the `goods_transfer` row
 * recording the movement's intent.
 *
 * A carrier booking is OPTIONAL. A hop between two of our own locations is
 * frequently someone driving a van, and that is still a real transfer whose
 * inventory consequences matter — so `carrier: undefined` records a `draft`
 * transfer with no AWB rather than refusing the movement.
 */

export type CreateProductionRunTransferInput = {
  productionRunId: string
  /** Destination stock location. */
  toLocationId: string
  /** Origin; defaults to the run's own goods location (see below). */
  fromLocationId?: string
  reason?: "finishing" | "qc" | "packaging" | "stock" | "customer" | "other"
  /** Units moving in this hop; defaults to what the run produced. */
  quantity?: number
  /**
   * Book with this carrier. Omitted → a `draft` transfer with no carrier
   * booking (a self-driven hop), which is a legitimate movement, not an error.
   */
  carrier?: string
  weightGrams?: number
  dimensionsCm?: Dimensions & { breadth?: number }
  preferredCourierId?: string | number
  /** Acting user's email recorded on a freshly-registered pickup (#427). */
  actingEmail?: string
  notes?: string
  /** Who reads the error — carrier-account failures are not a partner's doing. */
  audience?: "admin" | "partner"
}

export type ProductionRunTransferResult = {
  transfer_id: string
  status: string
  from_location_id: string
  to_location_id: string
  quantity: number
  carrier?: string
  awb?: string
  tracking_url?: string
  label_url?: string
  shipment_id?: string
}

/** Fetch a stock location with the address the carrier needs. */
async function getStockLocation(
  container: MedusaContainer,
  id: string
): Promise<any | null> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const { data } = await query.graph({
      entity: "stock_location",
      fields: ["id", "name", "metadata", "address.*"],
      filters: { id },
    })
    return data?.[0] || null
  } catch {
    return null
  }
}

/**
 * Where the run's goods physically are.
 *
 * Explicit input wins. Otherwise fall back to the location `stockFinishedGoodsStep`
 * would have stocked them at — the producing partner's store → default sales
 * channel → first stock location. That fallback is a RECONSTRUCTION, not a
 * record: nothing on the run says where its output was stocked (#891 S1 exists
 * to fix exactly that), so it is correct only for goods that have never moved.
 * Once a run has an earlier delivered transfer, THAT destination is where the
 * goods are, and it wins over the partner default.
 */
export async function resolveRunGoodsLocation(
  container: MedusaContainer,
  run: { id: string; partner_id?: string | null }
): Promise<string | undefined> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  // A previous hop that has been received is the most recent truth about where
  // the goods are — more reliable than any partner default.
  try {
    const service: any = container.resolve(FULLFILLED_ORDERS_MODULE)
    const prior = await service.listGoodsTransfers(
      { production_run_id: run.id, status: "delivered" },
      { order: { received_at: "DESC" }, take: 1 }
    )
    const landedAt = prior?.[0]?.to_location_id
    if (landedAt) return String(landedAt)
  } catch {
    // No transfers yet (or the listing failed) — fall through to the default.
  }

  if (!run.partner_id) return undefined
  try {
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["stores.default_sales_channel_id"],
      filters: { id: run.partner_id },
    })
    const scId = partners?.[0]?.stores?.[0]?.default_sales_channel_id
    if (!scId) return undefined
    const { data: channels } = await query.graph({
      entity: "sales_channels",
      fields: ["stock_locations.id"],
      filters: { id: scId },
    })
    return channels?.[0]?.stock_locations?.[0]?.id
  } catch {
    return undefined
  }
}

export async function createProductionRunTransfer(
  container: MedusaContainer,
  input: CreateProductionRunTransferInput
): Promise<ProductionRunTransferResult> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
  const transferService: any = container.resolve(FULLFILLED_ORDERS_MODULE)

  const run = await runService
    .retrieveProductionRun(input.productionRunId)
    .catch(() => null)
  if (!run) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${input.productionRunId} not found`
    )
  }

  const fromLocationId =
    input.fromLocationId || (await resolveRunGoodsLocation(container, run))
  if (!fromLocationId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Could not determine where this run's goods are. Pass an explicit source location, or link a stock location to the producing partner's sales channel."
    )
  }
  if (fromLocationId === input.toLocationId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The source and destination locations are the same — there is nothing to move."
    )
  }

  const toLocation = await getStockLocation(container, input.toLocationId)
  if (!toLocation) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Destination stock location ${input.toLocationId} not found`
    )
  }

  const quantity = transferQuantity(run, input.quantity)

  // The transfer row is created FIRST, before any carrier call. Two reasons:
  // the carrier reference has to be per-hop (`create/adhoc` dedupes on it, and
  // two hops of one run sharing a reference would assign against each other's
  // shipment — #1225), and a booking that fails then leaves a visible `draft`
  // the operator can retry, rather than a movement that never existed.
  const transfer = await transferService.createGoodsTransfers({
    production_run_id: run.id,
    design_id: run.design_id ?? null,
    quantity,
    from_location_id: fromLocationId,
    to_location_id: input.toLocationId,
    reason: input.reason || "stock",
    status: "draft",
    notes: input.notes ?? null,
  })

  const base: ProductionRunTransferResult = {
    transfer_id: transfer.id,
    status: "draft",
    from_location_id: fromLocationId,
    to_location_id: input.toLocationId,
    quantity,
  }

  // No carrier asked for → a self-driven hop. The transfer stands on its own.
  if (!input.carrier) return base

  const carrier = input.carrier
  const provider = await resolveShippingProvider(container, carrier)
  if (!provider.createShipment) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${carrier} provider does not support shipment creation`
    )
  }

  // Origin: the source location must be a registered carrier pickup. Reuse the
  // recorded nickname when there is one; otherwise register on the fly. There is
  // deliberately NO any-registered-pickup fallback — every party shares one
  // Shiprocket account, so "first registered pickup" is someone else's warehouse.
  const fromLocation = await getStockLocation(container, fromLocationId)
  let pickupLocationName: string
  try {
    // Register with the carrier actually being used. This used to always call
    // Shiprocket, so a Delhivery transfer shipped from a nickname Delhivery had
    // never heard of and was refused every time.
    pickupLocationName = await ensureCarrierPickup(container, carrier, fromLocationId, {
      email: input.actingEmail,
      metadata: fromLocation?.metadata,
    })
  } catch (e: any) {
    // Don't append a guess at the cause — the registration errors already name
    // the missing fields, and blaming "phone + pincode" for (say) an address
    // line the carrier rejected sends the operator to fix the wrong thing.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `The source location "${fromLocation?.name || fromLocationId}" could not be registered as a ${carrier} pickup: ${e?.message}`
    )
  }

  // Destination: a stock location carries a proper structured address, which is
  // exactly what the inventory-order path already knows how to turn into a
  // carrier-acceptable one. There is no free-form override here — a transfer
  // ships to a location, not to a person.
  const destinationAddress = resolveInventoryDestinationAddress(
    null,
    toLocation.address,
    toLocation.name
  )
  const missing = missingDestinationAddressFields(destinationAddress)
  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Destination location "${toLocation.name || input.toLocationId}" has an incomplete address (missing ${missing.join(", ")}). Complete it before booking a carrier for this transfer.`
    )
  }

  const taxId = await resolvePlatformTaxIdForCountry(
    container,
    destinationAddress.country_code || "IN"
  )

  const shipmentInput = buildTransferShipmentInput(run, {
    pickupLocationName,
    destinationAddress,
    quantity,
    weightGrams: input.weightGrams,
    // breadth → width, or the operator's breadth is silently dropped and the
    // carrier defaults the box to 10 cm.
    dimensionsCm: normalizeDimensionsCm(input.dimensionsCm as any),
    preferredCourierId: input.preferredCourierId,
    taxId,
    transferId: transfer.id,
  })

  let result
  try {
    result = await provider.createShipment(shipmentInput)
  } catch (e: any) {
    // Carrier-account failures (empty wallet, KYC, settlement bank) are none of
    // a partner's doing and unfixable from a dashboard they can't log into.
    const gate = describeIntlPrereqError({
      message: e?.message,
      fieldErrors: e?.fieldErrors,
    })
    if (gate?.reason === "insufficient_balance") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        input.audience === "partner" ? gate.partnerMessage : gate.message
      )
    }
    throw e
  }

  // Carrier refs land on an `inventory_shipment` row — the same shape the
  // tracking webhook already matches AWBs against, so a transfer tracks without
  // a second webhook path. Best-effort: the carrier shipment exists and has been
  // paid for; a persistence hiccup must not fail the call.
  let shipmentRecordId: string | undefined
  try {
    const record = await transferService.createInventoryShipments({
      carrier,
      awb: result.awb ?? null,
      tracking_number: result.tracking_number ?? null,
      tracking_url: result.tracking_url ?? null,
      label_url: result.label_url ?? null,
      pickup_location_name: pickupLocationName,
      pickup_stock_location_id: fromLocationId,
      status: "created",
      weight_grams: input.weightGrams ?? null,
      dimensions_cm: input.dimensionsCm ?? null,
      provider_refs: result.provider_refs ?? null,
      metadata: { context: "goods_transfer", goods_transfer_id: transfer.id },
    })
    shipmentRecordId = record.id
  } catch (e) {
    logger.error(
      `Failed to persist inventory_shipment for goods transfer ${transfer.id} (AWB ${result.awb}):`,
      e as Error
    )
  }

  await transferService.updateGoodsTransfers({
    id: transfer.id,
    status: "in_transit",
    shipped_at: new Date(),
    shipment_id: shipmentRecordId ?? null,
  })

  return {
    ...base,
    status: "in_transit",
    carrier,
    awb: result.awb,
    tracking_url: result.tracking_url,
    label_url: result.label_url,
    shipment_id: shipmentRecordId,
  }
}

const createProductionRunTransferStep = createStep(
  "create-production-run-transfer",
  async (input: CreateProductionRunTransferInput, { container }) => {
    const result = await createProductionRunTransfer(container, input)
    return new StepResponse(result)
  }
)

export const createProductionRunTransferWorkflow = createWorkflow(
  "create-production-run-transfer",
  (input: CreateProductionRunTransferInput) => {
    const result = createProductionRunTransferStep(input)
    return new WorkflowResponse(result)
  }
)
