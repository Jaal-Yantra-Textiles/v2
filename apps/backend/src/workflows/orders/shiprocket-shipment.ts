import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"
import type {
  CreateShipmentInput,
  CustomsDeclaration,
  Dimensions,
  ShipmentAddress,
  ShipmentItem,
  ShipmentResult,
} from "../../modules/shipping-providers/provider-interface"
import { resolveOriginAddress } from "../../modules/shipping-providers/origin-address"
import { resolveExportIgstForCountry } from "../../modules/shipping-providers/export-igst"
import {
  SHIPROCKET_PICKUP_METADATA_KEY,
  chooseRegisteredPickup,
  registerShiprocketPickup,
} from "../../modules/shipping-providers/pickup-locations"
import { resolveSellerTaxIdForOrder } from "../../modules/shipping-providers/seller-tax-id"
import { resolveOrderShipFromLocation } from "../../modules/shipping-providers/order-partner-origin"
import {
  describeIntlPrereqError,
  isInternationalDestination,
} from "../../modules/shipping-providers/shiprocket/client"
import {
  SHIPROCKET_FX_TARGET,
  SHIPROCKET_SUPPORTED_CURRENCIES,
  convertShipmentCurrency,
  isShiprocketSupportedCurrency,
} from "../../modules/shipping-providers/shiprocket/currency"
import { FX_RATES_MODULE } from "../../modules/fx_rates"
import { PARTNER_BILLING_MODULE } from "../../modules/partner_billing"
import {
  nonEmptyCode,
  resolveVariantHsCode,
} from "../../modules/shipping-providers/hs-code-resolution"

/**
 * #404 (#31) PR-B — generate a Shiprocket shipment (forward order → AWB → label)
 * for a fulfillment of a (converted) order, and persist the carrier refs onto
 * `fulfillment.data` so the existing label/tracking/pickup routes can read them.
 *
 * The admin creates the fulfillment first via Medusa core's
 * `POST /admin/orders/:id/fulfillments`; this drives the carrier off it — the
 * first consumer of `ShippingProviderClient.createShipment` (the label/tracking
 * routes only ever fetched against an already-populated `fulfillment.data`).
 */

const DEFAULT_WEIGHT_GRAMS = 500

export type OrderForShipment = {
  id: string
  email?: string | null
  total?: number | null
  subtotal?: number | null
  /**
   * Goods-only value. `subtotal` is NOT it — in Medusa v2 `order.subtotal`
   * INCLUDES shipping (verified on a live order: item_total 241.85 + shipping 39
   * = subtotal 280.85), so it over-declares a customs invoice by the freight.
   * `item_total` is post-discount, `item_subtotal` pre-discount.
   */
  item_total?: number | null
  item_subtotal?: number | null
  /** ISO-4217 currency the order was placed in — declared value for intl customs (#1111). */
  currency_code?: string | null
  metadata?: Record<string, any> | null
  shipping_address?: Record<string, any> | null
  /** Fallback source for phone / postal code the shipping address may lack. */
  billing_address?: Record<string, any> | null
  /** Fallback source for the buyer phone/name when neither address carries one. */
  customer?: {
    phone?: string | null
    email?: string | null
    first_name?: string | null
    last_name?: string | null
  } | null
  items?: Array<{
    /** Line id — the key `fulfillment.items[].line_item_id` points at. */
    id?: string | null
    title?: string | null
    quantity?: number | null
    unit_price?: number | null
    sku?: string | null
    /**
     * Product variant behind the line. `hs_code` lives on THREE core models —
     * the variant, its inventory item(s) and the parent product — and any of
     * them may be the one a merchant filled in. See `resolveLineHsn`.
     */
    variant?: {
      hs_code?: string | null
      product?: { hs_code?: string | null } | null
      inventory_items?: Array<{
        inventory?: { hs_code?: string | null } | null
      }> | null
    } | null
    /** HSN/HS-code fallback for ad-hoc (variant-less) lines. */
    metadata?: Record<string, any> | null
  }> | null
}

/**
 * Resolve the customs HSN/HS code for one order line (#1111).
 *
 * The catalogue half of the chain (variant → inventory item → product) lives in
 * `hs-code-resolution`, shared with the HS-code tooling that WRITES codes, so a
 * write always lands where the label reads. The one rung that is specific to an
 * order is the last: `line.metadata.hsn`, for ad-hoc / variant-less lines that
 * have no catalogue row to hang a code off at all.
 */
export function resolveLineHsn(
  li: NonNullable<OrderForShipment["items"]>[number]
): string | undefined {
  return (
    resolveVariantHsCode(li.variant).hs_code ?? nonEmptyCode(li.metadata?.hsn)
  )
}

/** One line of the fulfillment being shipped — what is actually in the box. */
export type FulfillmentLine = {
  line_item_id?: string | null
  quantity?: number | null
}

export type BuildShipmentOpts = {
  pickupLocationName?: string
  weightGrams?: number
  dimensionsCm?: Dimensions
  preferredCourierId?: string | number
  /** Seller tax/GST ID to stamp on the label (#348); resolved by the caller. */
  taxId?: string
  /**
   * The ship-from address, read off the fulfillment's stock location. Shiprocket
   * and Delhivery ignore it (they derive the origin from a registered pickup);
   * Blue Dart puts it on the waybill and rejects a blank one. Omitted when the
   * location has no usable address, which is the pre-existing behaviour.
   */
  originAddress?: ShipmentAddress
  /**
   * The fulfillment's own lines. When given, ONLY these are declared, at these
   * quantities — a shipment must describe what's in the box, not the whole
   * order. Omitted (or unresolvable) falls back to every order line, which is
   * correct for the single-fulfillment case and is what every caller did before.
   */
  fulfillmentItems?: FulfillmentLine[] | null
  /** Customs declaration overrides (#1216 export IGST); resolved by the caller. */
  customs?: CustomsDeclaration
}

/**
 * Restrict an order's lines to the ones this fulfillment actually ships, at the
 * fulfilled quantity. Pure & exported: a partial fulfillment that declared the
 * whole order overstated both the customs value AND the goods themselves —
 * declaring items that aren't in the box is a misdeclaration, not a rounding
 * error.
 *
 * Matching is by `line_item_id` only. Fulfillment items carry the VARIANT title
 * ("Chrome Yellow", "S") while order lines carry the product title, so titles
 * can't be joined on — and two lines of the same product would collide anyway.
 *
 * Returns the full list unchanged when there's nothing usable to filter by, so a
 * missing field selection degrades to today's behaviour rather than shipping an
 * empty declaration.
 */
export function selectFulfilledLines(
  lines: NonNullable<OrderForShipment["items"]>,
  fulfillmentItems?: FulfillmentLine[] | null
): { items: NonNullable<OrderForShipment["items"]>; partial: boolean } {
  if (!fulfillmentItems?.length) return { items: lines, partial: false }

  const byId = new Map(
    lines.filter((l) => l.id).map((l) => [String(l.id), l] as const)
  )
  const selected: NonNullable<OrderForShipment["items"]> = []
  for (const fi of fulfillmentItems) {
    const line = fi.line_item_id ? byId.get(String(fi.line_item_id)) : undefined
    if (!line) continue
    // The fulfilled quantity wins — one order line can be shipped across
    // several fulfillments, and each may carry only part of it.
    const qty = Number(fi.quantity)
    selected.push({
      ...line,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : line.quantity,
    })
  }
  if (!selected.length) return { items: lines, partial: false }

  const sameCount = selected.length === lines.length
  const sameQty = selected.every(
    (s) => Number(s.quantity) === Number(byId.get(String(s.id))?.quantity)
  )
  return { items: selected, partial: !(sameCount && sameQty) }
}

/**
 * Pure mapping from a core order onto a `CreateShipmentInput`. COD orders
 * (metadata.payment_mode === "cod") carry a `cod_amount` (the order total in
 * major units); prepaid orders don't. Exported for unit testing.
 */
export function buildCreateShipmentInput(
  order: OrderForShipment,
  opts: BuildShipmentOpts
): CreateShipmentInput {
  const addr = order.shipping_address || {}
  const billing = order.billing_address || {}
  // Shiprocket makes billing_phone and billing_pincode mandatory. The buyer's
  // phone is often captured on the order/customer or the billing address rather
  // than the shipping address, and the postal code can likewise live on billing
  // — sending "" 422s ("The billing phone field is required" / pincode). Walk
  // shipping → billing → customer so a complete order isn't blocked because one
  // field landed on a sibling record.
  const phone =
    nonEmptyCode(addr.phone) ||
    nonEmptyCode(billing.phone) ||
    nonEmptyCode(order.customer?.phone) ||
    ""
  const pincode = nonEmptyCode(addr.postal_code) || nonEmptyCode(billing.postal_code) || ""
  const paymentMode: "prepaid" | "cod" =
    order.metadata?.payment_mode === "cod" ? "cod" : "prepaid"

  // Declare what's in THIS box, not the whole order.
  const { items: fulfilledLines, partial } = selectFulfilledLines(
    order.items || [],
    opts.fulfillmentItems
  )
  const items: ShipmentItem[] = fulfilledLines.map((li) => ({
    name: li.title || "Item",
    sku: li.sku || undefined,
    quantity: Number(li.quantity) || 1,
    unit_price: Number(li.unit_price) || 0,
    // HSN for international customs (#1111) — variant → inventory item →
    // product → line metadata. Domestic shipments ignore it; the client
    // requires it only when the destination is international.
    hsn: resolveLineHsn(li),
  }))
  // Declared value = GOODS ONLY, and it must agree with the line items we send
  // (the carrier shows the invoice total, and customs duty abroad is charged on
  // it). `order.subtotal` includes shipping, so using it declared freight as
  // merchandise — inflating the total by the shipping charge and contradicting
  // the FOB terms we state, where freight is the buyer's cost, not part of the
  // invoice value. Prefer the goods figures; fall back to the line sum, which is
  // by construction consistent with what we declare.
  const lineSum = items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  // On a PARTIAL shipment the order-level goods totals describe the whole order,
  // so only the line sum can describe this box.
  const goodsTotal = partial
    ? lineSum
    : order.item_total != null
      ? Number(order.item_total)
      : order.item_subtotal != null
        ? Number(order.item_subtotal)
        : lineSum
  const subTotal = Number.isFinite(goodsTotal) && goodsTotal > 0 ? goodsTotal : lineSum

  // Recipient name: walk shipping → billing → customer, the same fallback the
  // phone and pincode already do above. Order 79's shipping address was replaced
  // with one carrying NO first/last name while billing still held "Yosef Pivk",
  // so we sent `shipping_customer_name: "Customer"` with an empty
  // `shipping_last_name` — and an international shipment must name its
  // recipient (it prints on the commercial invoice). "Customer" stays only as
  // the last resort for a genuinely nameless order.
  const nameFrom = (src: Record<string, any> | null | undefined) =>
    [src?.first_name, src?.last_name].filter(Boolean).join(" ").trim()
  const name =
    nameFrom(addr) || nameFrom(billing) || nameFrom(order.customer) || "Customer"

  return {
    reference_id: order.id,
    payment_mode: paymentMode,
    // A partial shipment must not collect the WHOLE order at the door — two
    // boxes would each ask the customer for the full order total. Collect only
    // what this box is worth; the full order total stays correct for the normal
    // ship-everything case.
    cod_amount:
      paymentMode === "cod"
        ? partial
          ? subTotal
          : Number(order.total) || subTotal
        : undefined,
    // "" lets the client fall back to its configured default pickup location.
    pickup_location_name: opts.pickupLocationName || "",
    to: {
      name,
      phone,
      email: order.email || addr.email || billing.email || order.customer?.email || undefined,
      address_1: addr.address_1 || "",
      address_2: addr.address_2 || undefined,
      city: addr.city || "",
      state: addr.province || "",
      pincode,
      country: addr.country_code ? String(addr.country_code).toUpperCase() : "IN",
    },
    // Blue Dart stamps this onto the waybill (Shipper + Returnadds) and rejects
    // a blank one with an empty-bodied 400. Shiprocket and Delhivery ignore it
    // and derive the origin from the registered pickup, so leaving it undefined
    // when the location has no usable address changes nothing for them.
    from: opts.originAddress,
    items,
    weight_grams: opts.weightGrams || DEFAULT_WEIGHT_GRAMS,
    dimensions_cm: opts.dimensionsCm,
    sub_total: subTotal,
    // Declared-value currency for international customs (#1111). Shiprocket reads
    // intl amounts in this currency; domestic ignores it.
    currency: order.currency_code ? String(order.currency_code).toUpperCase() : undefined,
    preferred_courier_id: opts.preferredCourierId,
    tax_id: opts.taxId,
    customs: opts.customs,
  }
}

export type CreateShiprocketShipmentInput = {
  orderId: string
  fulfillmentId: string
  /** Defaults to "shiprocket". */
  carrier?: string
  pickupLocationName?: string
  /**
   * Explicit ship-from stock location (#772 core-order half — partner label
   * flow). Registered/confirmed as a carrier pickup on the fly (idempotent);
   * when set, the any-registered-pickup fallback below is NEVER used — a
   * partner's label must not ship from another party's warehouse on the
   * shared Shiprocket account.
   */
  pickupStockLocationId?: string
  /** Acting user's email recorded on a freshly-registered pickup (#427). */
  actingEmail?: string
  weightGrams?: number
  dimensionsCm?: Dimensions
  preferredCourierId?: string | number
  /**
   * Who is reading the error. Carrier-account failures (empty wallet, KYC,
   * settlement bank, pickup not international-enabled) are none of a partner's
   * doing and none of them are fixable from a dashboard they can't log into —
   * so a partner gets "load courier credits or contact support" where an admin
   * gets the Shiprocket dashboard path. Defaults to admin wording.
   */
  audience?: "admin" | "partner"
}

export async function createShiprocketShipmentForFulfillment(
  container: MedusaContainer,
  input: CreateShiprocketShipmentInput
): Promise<ShipmentResult & { fulfillment_id: string }> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "email",
      "total",
      "subtotal",
      // Goods-only totals — `subtotal` includes shipping and must not be used as
      // the declared customs value.
      "item_total",
      "item_subtotal",
      "currency_code",
      "metadata",
      "shipping_address.*",
      // Fallback source for phone / postal code the shipping address may lack.
      "billing_address.*",
      "customer.phone",
      "customer.email",
      // Last-resort recipient name when neither address carries one.
      "customer.first_name",
      "customer.last_name",
      // Line id — the join key for `fulfillment.items[].line_item_id`.
      "items.id",
      "items.title",
      "items.quantity",
      "items.unit_price",
      "items.metadata",
      // All three levels `resolveLineHsn` walks. Dotted paths, never `*variant`
      // — a star on a relation silently drops it from the result.
      "items.variant.hs_code",
      "items.variant.product.hs_code",
      "items.variant.inventory_items.inventory.hs_code",
      "fulfillments.id",
      "fulfillments.location_id",
      "fulfillments.data",
      // What is actually in the box. Must be named explicitly — the default order
      // payload returns `fulfillments.items` EMPTY, so the shipment silently
      // declared every line of the order instead.
      "fulfillments.items.line_item_id",
      "fulfillments.items.quantity",
    ],
    filters: { id: input.orderId },
  })
  const order = orders?.[0]
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.orderId} not found`)
  }
  const fulfillment = (order.fulfillments || []).find(
    (f: any) => f.id === input.fulfillmentId
  )
  if (!fulfillment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Fulfillment ${input.fulfillmentId} not found on order ${input.orderId}`
    )
  }

  // Pickup nickname: explicit name → explicit ship-from stock location
  // (registered on the fly, no fallback past it) → the fulfillment's
  // stock-location Shiprocket nickname → (registered-pickup fallback, #638).
  let pickupLocationName = input.pickupLocationName
  if (!pickupLocationName && input.pickupStockLocationId) {
    try {
      const reg = await registerShiprocketPickup(
        container,
        input.pickupStockLocationId,
        { email: input.actingEmail }
      )
      pickupLocationName = reg.name
    } catch (e: any) {
      // A clean 400 with the reason — never a silent wrong-origin shipment.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `The ship-from location ${input.pickupStockLocationId} could not be used as a carrier pickup: ${e?.message}`
      )
    }
  }
  if (!pickupLocationName && fulfillment.location_id) {
    const { data: locs } = await query.graph({
      entity: "stock_location",
      fields: ["id", "metadata"],
      filters: { id: fulfillment.location_id },
    })
    pickupLocationName = (locs?.[0]?.metadata as any)?.[
      SHIPROCKET_PICKUP_METADATA_KEY
    ]
  }

  // Retail / admin partner-origin (#1111 S4). Retail orders arrive with no
  // partner in the auth context, so the label flow can't derive the owning
  // partner's pickup from the caller — resolve it FROM THE ORDER (retail →
  // sales-channel; work → link) and ship from THAT partner's location,
  // registered on the fly. Best-effort: only when no explicit ship-from was
  // given and we still have no pickup; a miss falls through to the #638
  // any-registered fallback below, so existing admin design-order labels are
  // unaffected. This stops a retail label from silently shipping from another
  // party's warehouse on the shared Shiprocket account.
  if (!pickupLocationName && !input.pickupStockLocationId) {
    const origin = await resolveOrderShipFromLocation(container, input.orderId)
    if (origin.locationId) {
      try {
        const reg = await registerShiprocketPickup(container, origin.locationId, {
          email: input.actingEmail || origin.actingEmail || undefined,
        })
        pickupLocationName = reg.name
      } catch {
        // Best-effort — the #638 fallback (or the guard) handles it cleanly.
      }
    }
  }

  const carrier = input.carrier || "shiprocket"
  const provider = await resolveShippingProvider(container, carrier)
  if (!provider.createShipment) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${carrier} provider does not support shipment creation`
    )
  }

  // Fallback: when neither an explicit name nor the fulfillment's stock-location
  // nickname resolves a pickup, ship from a registered Shiprocket pickup (prefer
  // a shippable one). This is what makes Generate-Label work for converted
  // design orders whose fulfillment landed on a non-registered stock location.
  // (#638) — ADMIN flows only: an explicit pickupStockLocationId (partner label
  // flow) must never fall through to another party's warehouse.
  if (
    !pickupLocationName &&
    !input.pickupStockLocationId &&
    provider.listPickupLocations
  ) {
    try {
      const registered = await provider.listPickupLocations()
      pickupLocationName = chooseRegisteredPickup(registered)?.name
    } catch {
      // Listing is best-effort; the guard below produces the actionable error.
    }
  }

  if (!pickupLocationName) {
    // A clean MedusaError (not a raw 500) so the UI shows an actionable toast. (#638)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `No ${carrier} pickup location is configured. Register a pickup location for the order's stock location (or any ${carrier} pickup) before generating a label.`
    )
  }

  // Seller tax/GST ID (#348): partner-own → platform-by-country fallback.
  const taxId = await resolveSellerTaxIdForOrder(
    container,
    order.id,
    (order as any)?.shipping_address?.country_code
  )

  // Declare the fulfillment's own lines, not the order's. `fulfillment.items`
  // has to be requested explicitly — the default order payload returns it empty,
  // which is exactly how declaring every order line went unnoticed.
  const fulfillmentItems = (fulfillment as any)?.items as
    | FulfillmentLine[]
    | undefined
  if (!fulfillmentItems?.length) {
    logger.warn(
      `Fulfillment ${input.fulfillmentId} exposed no items; declaring all lines of order ${input.orderId} to ${carrier}. Correct for a single full fulfillment, over-declares a partial one.`
    )
  }

  // Export IGST status (#1216). Only meaningful for a cross-border shipment, so
  // don't spend the query on a domestic label.
  //
  // Who owns the declaration depends on whether any LUT has been RECORDED:
  //
  //  · none recorded → pass nothing, so the client's own default applies. That
  //    keeps `SHIPROCKET_IGST_PAYMENT_STATUS` working as the escape hatch for the
  //    window between an ARN being issued and the LUT being entered.
  //  · any recorded → the table decides, and we pass its verdict EXPLICITLY,
  //    including "C". This is the important half: without it, an expired LUT plus
  //    a stale env `=B` would keep claiming the exemption, silently defeating the
  //    validity window that the whole feature is built on. Once the data exists,
  //    the env must not be able to override it.
  let customs: CustomsDeclaration | undefined
  const destinationCountry = (order as any)?.shipping_address?.country_code
  if (isInternationalDestination(destinationCountry)) {
    const igst = await resolveExportIgstForCountry(container)
    if (igst.status === "B") {
      customs = { igst_payment_status: "B" }
      logger.info(
        `Export declared under LUT ${igst.lut_arn} (FY ${igst.financial_year}, ${igst.days_until_expiry} days left) for order ${input.orderId}`
      )
    } else if (igst.has_recorded_lut) {
      customs = { igst_payment_status: "C" }
      logger.warn(
        `Export declaring IGST as paid/reclaimed ("C") for order ${input.orderId}: an LUT is on record but none is currently in force (expired or withdrawn). Re-furnish RFD-11 and record it under Settings → Export LUT.`
      )
    }
  }

  let shipmentInput = buildCreateShipmentInput(order as OrderForShipment, {
    pickupLocationName,
    weightGrams: input.weightGrams,
    dimensionsCm: input.dimensionsCm,
    preferredCourierId: input.preferredCourierId,
    taxId,
    fulfillmentItems,
    customs,
    // Read from the fulfillment's own location, not the resolved pickup NAME:
    // the name is a carrier-side registry key (and often the derived
    // `warehouse-<last8>` handle), while this is the postal address Blue Dart
    // puts on the waybill and the customs paperwork.
    originAddress: await resolveOriginAddress(container, fulfillment.location_id),
  })

  // International FX (#1111 S3). Shiprocket declares the customs value only in a
  // fixed currency set; an order priced outside it (e.g. THB/JPY/ZAR) must be
  // converted or the commercial invoice is invalid. Convert the declared value +
  // line prices into USD at the cached FX rate. A missing rate is a clean,
  // actionable error rather than a confusing carrier-side rejection. Domestic
  // and already-supported currencies pass through untouched.
  if (
    isInternationalDestination(shipmentInput.to.country) &&
    shipmentInput.currency &&
    !isShiprocketSupportedCurrency(shipmentInput.currency)
  ) {
    const from = shipmentInput.currency
    try {
      const fx: any = container.resolve(FX_RATES_MODULE)
      const rate = await fx.getRate(from, SHIPROCKET_FX_TARGET)
      shipmentInput = convertShipmentCurrency(
        shipmentInput,
        SHIPROCKET_FX_TARGET,
        rate
      )
    } catch (e: any) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Cannot ship internationally in ${from}: Shiprocket accepts only ${Array.from(
          SHIPROCKET_SUPPORTED_CURRENCIES
        ).join(", ")}, and no FX rate ${from}→${SHIPROCKET_FX_TARGET} is available (${
          e?.message || "no path"
        }). Add the FX rate or price this order in a supported currency.`
      )
    }
  }

  // #1118 intl-prerequisites gate: Shiprocket rejects an international
  // create/label when the account isn't cross-border ready (KYC unverified,
  // bank details missing, pickup not international-enabled). Turn those opaque
  // ShiprocketApiError messages into an actionable admin error before they
  // reach the UI toast; anything unrecognised rethrows untouched.
  let result
  try {
    result = await provider.createShipment(shipmentInput)
  } catch (e: any) {
    const gate = describeIntlPrereqError({
      message: e?.message,
      fieldErrors: e?.fieldErrors,
    })
    // KYC / bank / pickup-not-international are international-only signatures.
    // An empty WALLET is not: a domestic label fails on it identically, and it
    // used to surface as a raw carrier string ("Insufficient amount to label this
    // shipment") on the domestic path. Keyword matching is fuzzy, so only the
    // balance gate is trusted for a domestic destination.
    const applies =
      gate &&
      (isInternationalDestination(shipmentInput.to.country) ||
        gate.reason === "insufficient_balance")
    if (gate && applies) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        input.audience === "partner" ? gate.partnerMessage : gate.message
      )
    }
    throw e
  }

  // Persist the carrier refs onto fulfillment.data (what label/tracking read),
  // AND stamp the AWB as a fulfillment_label tracking number — the queryable
  // key the tracking webhook matches core-order pushes on (data.waybill is
  // JSONB and can't be filtered). Only when an AWB actually came back.
  await fulfillmentModule.updateFulfillment(input.fulfillmentId, {
    data: {
      ...(fulfillment.data || {}),
      carrier,
      waybill: result.awb,
      tracking_number: result.tracking_number,
      tracking_url: result.tracking_url,
      label_url: result.label_url,
      shipment_id: result.provider_refs?.shipment_id,
      sr_order_id: result.provider_refs?.sr_order_id,
      provider_refs: result.provider_refs,
    },
    ...(result.awb
      ? {
          labels: [
            {
              tracking_number: result.awb,
              tracking_url: result.tracking_url || "",
              label_url: result.label_url || "",
            },
          ],
        }
      : {}),
  })

  await recordPlatformShippingCost(
    container,
    input.orderId,
    input.fulfillmentId,
    carrier,
    result
  )

  return { ...result, fulfillment_id: input.fulfillmentId }
}

/**
 * Record what this label cost us on the order's `partner_fee` row.
 *
 * The partner shipped on the PLATFORM's carrier account, so the freight is a
 * deduction from their payout on top of the commission — and the partner needs
 * to see it, because they charged the customer a flat shipping rate while our
 * real cost varies by lane.
 *
 * Booked against the FULFILLMENT, not just the order. `partner_fee` is one row
 * per order but freight is bought per box, so writing a bare scalar meant the
 * second box's label overwrote the first box's cost and the partner was
 * under-charged for every multi-box order. The ledger upserts by fulfillment id,
 * which also makes re-labelling the same box correct it rather than double-bill.
 *
 * Best-effort by design: a billing bookkeeping write must never fail a label
 * that the carrier has already accepted and assigned an AWB to. A miss leaves
 * the payout line absent, which reads as "no platform shipping" — the same as
 * before this existed — rather than breaking the shipment.
 */
async function recordPlatformShippingCost(
  container: MedusaContainer,
  orderId: string,
  fulfillmentId: string,
  carrier: string,
  result: ShipmentResult
): Promise<void> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const rate = result.provider_refs?.courier_rate
    const amount = Number(rate)
    // No quoted rate (carrier didn't return one) → nothing to record. Note 0 IS
    // recordable: free shipping is a real outcome, absence is not.
    if (rate == null || !Number.isFinite(amount)) {
      return
    }

    const billing: any = container.resolve(PARTNER_BILLING_MODULE)
    // Returns null for a retail order with no partner, or when the accrual
    // subscriber hasn't run — there is no row to hang the cost off, and
    // inventing one here isn't this path's business; accrual owns that
    // lifecycle.
    await billing.recordShippingChargeForOrder(orderId, {
      fulfillment_id: fulfillmentId,
      amount,
      currency_code: String(
        result.provider_refs?.courier_rate_currency || "INR"
      ).toUpperCase(),
      carrier,
      awb: result.awb || null,
    })
  } catch (e: any) {
    logger?.warn?.(
      `[shiprocket-shipment] could not record platform shipping cost for order ${orderId}: ${e?.message}`
    )
  }
}
