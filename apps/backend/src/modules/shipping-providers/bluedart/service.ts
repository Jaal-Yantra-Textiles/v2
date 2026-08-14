import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import {
  CreateFulfillmentResult,
  FulfillmentOption,
  FulfillmentItemDTO,
  FulfillmentOrderDTO,
  FulfillmentDTO,
  CalculatedShippingOptionPrice,
  CreateShippingOptionDTO,
  Logger,
} from "@medusajs/framework/types"
import { BlueDartClient } from "./client"
import { BlueDartProviderAdapter } from "./adapter"
import { BLUEDART_CARRIER_ID } from "./constants"
import type { BlueDartConfig } from "./types"
import { CreateShipmentInput, ShipmentItem } from "../provider-interface"

type InjectedDeps = { logger: Logger }

/**
 * Blue Dart fulfillment provider (#1285).
 *
 * Blue Dart has been drivable from admin/partner routes since #1286 — it is in
 * `SUPPORTED_CARRIERS` and `resolveShippingProvider` returns a live client for
 * it. What it was NOT is a *Medusa fulfillment provider*: `bluedart/index.ts`
 * was a plain barrel, so the fulfillment module never saw it, and it therefore
 * never appeared in Settings → Locations & Shipping. It could not be attached
 * to a stock location or a shipping option the way Delhivery and Shiprocket can.
 * This file closes that gap; the carrier logic itself is unchanged and still
 * lives in `BlueDartProviderAdapter`.
 *
 * ⚠️ A live `createShipment` mints a REAL, BILLABLE waybill — Blue Dart's
 * sandbox host is a separate base URL, not a dry-run flag on production. The
 * registration in `medusa-config.ts` sits behind `ENABLE_CARRIER_FULFILLMENT`
 * for exactly this reason.
 */
class BlueDartFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = BLUEDART_CARRIER_ID

  protected adapter: BlueDartProviderAdapter
  protected logger: Logger

  constructor({ logger }: InjectedDeps, options: BlueDartConfig) {
    super()
    this.logger = logger
    this.adapter = new BlueDartProviderAdapter(new BlueDartClient(options))
  }

  /**
   * One domestic option, deliberately.
   *
   * `createShipment` picks the product code from the destination
   * (`BLUEDART_PRODUCT.domestic` vs `.international`), not from the chosen
   * option — so advertising Apex/Surface here would offer service levels that
   * all ship as `D` regardless. Per-option product selection needs the adapter
   * to accept a product code first; until then one honest option beats four
   * misleading ones.
   *
   * International (product `H`, sub-products IPC-Expedited / IPC-Standard —
   * confirmed against `GetAllProductsAndSubProducts`) is intentionally NOT
   * offered: it is still blocked on #1223's HS codes and on the unverified
   * single-letter waybill `SubProductCode`.
   */
  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      {
        id: "bluedart-domestic-priority",
        name: "Blue Dart Domestic Priority",
        is_return: false,
      },
      {
        id: "bluedart-domestic-priority-return",
        name: "Blue Dart Domestic Priority - Return",
        is_return: true,
      },
    ]
  }

  /**
   * Serviceability is advisory here, never a hard block.
   *
   * The Finder has a demonstrated flap (real data once, then `UserDoesNotExists`
   * on six consecutive identical calls on 2026-08-14). Refusing an option on a
   * transient carrier error would take checkout down for lanes that are in fact
   * serviceable, so a failed check warns and passes.
   */
  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: any
  ): Promise<Record<string, unknown>> {
    const pin =
      (data.shipping_address as any)?.postal_code || (data as any).postal_code
    if (pin) {
      try {
        const ok = await this.adapter.checkServiceability(String(pin))
        if (!ok) {
          this.logger.warn(
            `Blue Dart reports pincode ${pin} is not serviceable inbound`
          )
        }
      } catch (e: any) {
        this.logger.warn(`Blue Dart serviceability check failed: ${e.message}`)
      }
    }
    return { ...data, ...optionData }
  }

  async validateOption(_data: Record<string, any>): Promise<boolean> {
    return true
  }

  /**
   * False — and that is the accurate answer, not a stub.
   *
   * Blue Dart exposes no rate API through this integration (the adapter has no
   * `getRates`), so there is nothing to calculate. Returning true and then
   * answering 0 — as the other two carriers do on their error paths — would
   * silently price shipping at zero. Shipping options on this provider must be
   * flat-rate.
   */
  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return false
  }

  async calculatePrice(
    _optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    _context: any
  ): Promise<CalculatedShippingOptionPrice> {
    throw new Error(
      "Blue Dart has no rate API wired — use a flat-rate shipping option"
    )
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const shippingAddress = (order as any)?.shipping_address || {}
    const fromLocation = (data as any).from_location || {}

    // Weight/dims come off the ORDER's line-item variants: the FulfillmentItemDTO
    // passed here carries no variant. Same approach as Delhivery and Shiprocket.
    const orderItems = ((order as any)?.items || []) as any[]
    const orderItemById = new Map<string, any>()
    for (const oi of orderItems) if (oi.id) orderItemById.set(oi.id, oi)

    let totalWeight = 0
    let maxLength = 0
    let maxWidth = 0
    let maxHeight = 0
    let hasWeight = false
    const shipItems: ShipmentItem[] = []

    for (const fItem of items) {
      const qty = (fItem as any).quantity || 1
      const oi = orderItemById.get((fItem as any).line_item_id)
      const variant = oi?.variant
      if (variant?.weight) {
        hasWeight = true
        totalWeight += variant.weight * qty
      }
      if (variant?.length && variant.length > maxLength) maxLength = variant.length
      if (variant?.width && variant.width > maxWidth) maxWidth = variant.width
      if (variant?.height) maxHeight += variant.height * qty

      shipItems.push({
        name: (fItem as any).title || oi?.title || "Item",
        sku: oi?.variant_sku || undefined,
        quantity: qty,
        unit_price: oi?.unit_price || 0,
      })
    }

    // No variant carried a weight — estimate. Order 83 hit exactly this path;
    // the real fix is per-variant weights alongside #1223.
    if (!hasWeight) {
      const totalQty = shipItems.reduce((s, i) => s + i.quantity, 0)
      totalWeight = Math.max(400, totalQty * 400)
    }

    const paymentStatus = (order as any)?.payment_status
    const isPrepaid = paymentStatus === "captured" || paymentStatus === "paid"
    const subTotal = shipItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)

    const input: CreateShipmentInput = {
      reference_id: (order as any)?.id || fulfillment.id || "",
      payment_mode: isPrepaid ? "prepaid" : "cod",
      cod_amount: isPrepaid ? undefined : subTotal,
      // Blue Dart keeps NO pickup-location registry (#1296) — the collection
      // address travels inline on every call, built by the adapter from the
      // stock location. This name is a label, never a carrier-side handle.
      pickup_location_name: fromLocation.name || undefined,
      to: {
        name:
          `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}`.trim() ||
          "Customer",
        phone: shippingAddress.phone || "",
        email: (order as any)?.email || undefined,
        address_1: shippingAddress.address_1 || "",
        address_2: shippingAddress.address_2 || undefined,
        city: shippingAddress.city || "",
        state: shippingAddress.province || "",
        pincode: shippingAddress.postal_code || "",
        country: shippingAddress.country_code || "India",
      },
      items: shipItems,
      weight_grams: totalWeight,
      dimensions_cm:
        maxLength && maxWidth && maxHeight
          ? { length: maxLength, width: maxWidth, height: maxHeight }
          : undefined,
      sub_total: subTotal,
    }

    try {
      const result = await this.adapter.createShipment(input)
      this.logger.info(`Blue Dart shipment created: awb=${result.awb}`)
      return {
        data: {
          carrier: BLUEDART_CARRIER_ID,
          waybill: result.awb,
          tracking_number: result.tracking_number,
          ...result.provider_refs,
        },
        labels: result.awb
          ? [
              {
                tracking_number: result.tracking_number || result.awb,
                tracking_url: result.tracking_url || "",
                label_url: result.label_url || "",
              },
            ]
          : [],
      }
    } catch (e: any) {
      // #1296 made these messages carry the carrier's own `error-response[]`.
      this.logger.error(`Blue Dart createFulfillment error: ${e.message}`)
      throw e
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    const waybill = fulfillment?.data?.waybill || fulfillment?.data?.tracking_number
    if (!waybill) return {}
    try {
      return await this.adapter.cancelShipment({
        awb: String(waybill),
        provider_refs: { waybill: String(waybill) },
      })
    } catch (e: any) {
      this.logger.error(`Blue Dart cancelFulfillment error: ${e.message}`)
      throw e
    }
  }
}

export default BlueDartFulfillmentService
