import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"
import {
  CreateFulfillmentResult,
  FulfillmentOption,
  FulfillmentItemDTO,
  FulfillmentOrderDTO,
  FulfillmentDTO,
  CalculatedShippingOptionPrice,
  CreateShippingOptionDTO,
} from "@medusajs/framework/types"
import { DelhiveryClient, DelhiveryOptions } from "./client"
import { Logger } from "@medusajs/framework/types"

type InjectedDeps = { logger: Logger }

class DelhiveryFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "delhivery"

  protected client: DelhiveryClient
  protected logger: Logger

  constructor({ logger }: InjectedDeps, options: DelhiveryOptions) {
    super()
    this.logger = logger
    this.client = new DelhiveryClient(options)
  }

  /**
   * Register a warehouse with Delhivery. Called during store creation.
   * Delegates to the underlying DelhiveryClient.
   */
  async registerWarehouse(warehouse: Parameters<DelhiveryClient["registerWarehouse"]>[0]) {
    return this.client.registerWarehouse(warehouse)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      {
        id: "delhivery-surface-standard",
        name: "Delhivery Standard (Surface)",
        mode: "Surface",
        is_return: false,
      },
      {
        id: "delhivery-surface-return",
        name: "Delhivery Standard (Surface) - Return",
        mode: "Surface",
        is_return: true,
      },
      {
        id: "delhivery-express",
        name: "Delhivery Express",
        mode: "Express",
        is_return: false,
      },
      {
        id: "delhivery-express-return",
        name: "Delhivery Express - Return",
        mode: "Express",
        is_return: true,
      },
    ]
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: any
  ): Promise<Record<string, unknown>> {
    // Validate that the destination pincode is serviceable
    const pin = (data.shipping_address as any)?.postal_code || data.postal_code
    if (pin) {
      try {
        const result = await this.client.checkServiceability(String(pin))
        if (!result?.delivery_codes?.length) {
          throw new Error(`Pincode ${pin} is not serviceable by Delhivery`)
        }
      } catch (e: any) {
        this.logger.warn(`Delhivery serviceability check failed: ${e.message}`)
      }
    }
    return { ...data, ...optionData }
  }

  async validateOption(data: Record<string, any>): Promise<boolean> {
    return true
  }

  async canCalculate(data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: any
  ): Promise<CalculatedShippingOptionPrice> {
    try {
      const fromLocation = (context as any).from_location
      const originPin = String(fromLocation?.address?.postal_code || "")
      const shippingAddress = (context as any).shipping_address
      const destPin = String(shippingAddress?.postal_code || "")

      this.logger.info(`Delhivery calculatePrice: origin=${originPin}, dest=${destPin}`)

      // Delhivery requires valid 6-digit Indian pincodes
      const isValidPin = (pin: string) => /^\d{6}$/.test(pin)

      if (!isValidPin(originPin) || !isValidPin(destPin)) {
        this.logger.warn(
          `Delhivery calculatePrice: invalid pincodes (origin=${originPin}, dest=${destPin}). ` +
          `Delhivery requires 6-digit Indian pincodes.`
        )
        return { calculated_amount: 0, is_calculated_price_tax_inclusive: false }
      }

      // Calculate total weight from cart items.
      // context.items comes from the cart and includes variant data.
      const items = (context as any).items || []
      let totalWeight = 0
      let hasActualWeight = false
      let totalQuantity = 0

      for (const item of items) {
        const qty = item.quantity || 1
        totalQuantity += qty
        if (item.variant?.weight) {
          hasActualWeight = true
          totalWeight += item.variant.weight * qty
        }
      }

      // Fallback: quantity-based bracket estimation (same logic as createFulfillment)
      if (!hasActualWeight) {
        if (totalQuantity <= 1) totalWeight = 400
        else if (totalQuantity <= 2) totalWeight = 800
        else if (totalQuantity <= 3) totalWeight = 1200
        else if (totalQuantity <= 5) totalWeight = 2000
        else if (totalQuantity <= 10) totalWeight = 3500
        else totalWeight = totalQuantity * 500
      }

      const result = await this.client.calculateShippingCost({
        origin_pin: originPin,
        destination_pin: destPin,
        weight: totalWeight || 400,
      })

      // Delhivery returns an array of charge objects
      const charges = Array.isArray(result) ? result : [result]
      const charge = charges[0]?.total_amount || 0

      this.logger.info(`Delhivery calculatePrice result: ${charge}`)

      return {
        calculated_amount: charge,
        is_calculated_price_tax_inclusive: true,
      }
    } catch (e: any) {
      this.logger.error(`Delhivery calculatePrice error: ${e.message}`)
      return { calculated_amount: 0, is_calculated_price_tax_inclusive: false }
    }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const shippingAddress = (order as any)?.shipping_address || {}
    const fromLocation = (data as any).from_location || {}

    try {
      const productDesc = items.map((i: any) => i.title || "Item").join(", ")
      const totalQuantity = items.reduce(
        (sum: number, item: any) => sum + ((item as any).quantity || 1),
        0
      )

      // Build a lookup of order line items by ID — these carry the variant with
      // weight/dimensions that Medusa's createOrderFulfillmentWorkflow queries.
      // The `items` parameter (FulfillmentItemDTO[]) does NOT include variant data.
      const orderItems = ((order as any)?.items || []) as any[]
      const orderItemById = new Map<string, any>()
      for (const oi of orderItems) {
        if (oi.id) orderItemById.set(oi.id, oi)
      }

      // Weight & dimensions: read from order.items[n].variant (set at product creation).
      // When variant weight is not set, use quantity-based bracket estimation.
      let totalWeight = 0
      let maxLength = 0
      let maxWidth = 0
      let maxHeight = 0
      let hasActualWeight = false

      for (const fItem of items) {
        const qty = (fItem as any).quantity || 1
        const orderItem = orderItemById.get((fItem as any).line_item_id)
        const variant = orderItem?.variant

        if (variant?.weight) {
          hasActualWeight = true
          totalWeight += variant.weight * qty
        }

        // Dimensions from variant (cm) — max L/W, stacked height
        if (variant?.length && variant.length > maxLength) maxLength = variant.length
        if (variant?.width && variant.width > maxWidth) maxWidth = variant.width
        if (variant?.height) maxHeight += variant.height * qty
      }

      // Fallback: if no variant had weight set, estimate by total quantity.
      // Delhivery charges by weight slabs (0-500g, 500g-1kg, 1-2kg, 2-5kg, 5kg+).
      // For textiles, a typical single garment is ~400g. We use bracket-based
      // estimation so we don't overpay (e.g. 1 light item shouldn't be 500g).
      if (!hasActualWeight) {
        // Quantity-based weight brackets (grams)
        //   1 item  → 400g  (light garment / dupatta)
        //   2 items → 800g  (two garments fit in 0.5-1kg slab)
        //   3 items → 1200g (1-2kg slab)
        //   4-5     → 2000g (2kg slab)
        //   6-10    → 3500g (2-5kg slab)
        //   11+     → 500g per item (bulk)
        if (totalQuantity <= 1) totalWeight = 400
        else if (totalQuantity <= 2) totalWeight = 800
        else if (totalQuantity <= 3) totalWeight = 1200
        else if (totalQuantity <= 5) totalWeight = 2000
        else if (totalQuantity <= 10) totalWeight = 3500
        else totalWeight = totalQuantity * 500

        // Default dimensions for textile packaging when not set on variant
        if (!maxLength) maxLength = 30
        if (!maxWidth) maxWidth = 25
        if (!maxHeight) maxHeight = Math.max(3, totalQuantity * 2)

        this.logger.warn(
          `Delhivery: no variant weight set — using bracket estimate: ` +
          `${totalWeight}g for ${totalQuantity} items`
        )
      }

      this.logger.info(
        `Delhivery shipment: ${totalWeight}g, ${totalQuantity} items, ` +
        `dims: ${maxLength}x${maxWidth}x${maxHeight}cm, ` +
        `weight source: ${hasActualWeight ? "variant" : "bracket estimate"}`
      )

      // Use registered warehouse name from stock location metadata, fall back to location name
      const pickupLocationName =
        fromLocation.metadata?.delhivery_warehouse_name ||
        fromLocation.name ||
        "Default"

      // Detect payment mode from order payment status
      const paymentStatus = (order as any)?.payment_status
      const paymentMode: "Pre-paid" | "COD" =
        paymentStatus === "captured" || paymentStatus === "paid"
          ? "Pre-paid"
          : "Pre-paid" // Default to Pre-paid; COD requires explicit setup

      // Let Delhivery auto-assign waybill (waybill: "")
      const result = await this.client.createShipment({
        waybill: "",
        name: `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}`.trim() || "Customer",
        phone: shippingAddress.phone || "",
        address: [shippingAddress.address_1, shippingAddress.address_2].filter(Boolean).join(", "),
        city: shippingAddress.city || "",
        pin: shippingAddress.postal_code || "",
        state: shippingAddress.province || "",
        country: shippingAddress.country_code || "India",
        order_id: (order as any)?.id || fulfillment.id || "",
        payment_mode: paymentMode,
        pickup_location_name: pickupLocationName,
        product_desc: productDesc,
        weight: totalWeight || 500,
        quantity: totalQuantity,
        length: maxLength || undefined,
        width: maxWidth || undefined,
        height: maxHeight || undefined,
        seller_name: fromLocation.name || "",
        seller_address: fromLocation.address?.address_1 || "",
        seller_city: fromLocation.address?.city || "",
        seller_pin: fromLocation.address?.postal_code || "",
        seller_state: fromLocation.address?.province || "",
      })

      // Extract auto-assigned waybill from response
      const autoWaybill =
        result?.packages?.[0]?.waybill ||
        result?.upload_wbn ||
        result?.waybill ||
        ""

      this.logger.info(`Delhivery shipment created: waybill=${autoWaybill}`)

      // Don't fetch label immediately — it may not be ready. Partners fetch on demand.
      return {
        data: {
          waybill: autoWaybill,
          tracking_number: autoWaybill,
          carrier: "delhivery",
          pickup_location_name: pickupLocationName,
          ...result,
        },
        labels: autoWaybill
          ? [{
              tracking_number: autoWaybill,
              tracking_url: `https://www.delhivery.com/track/package/${autoWaybill}`,
              label_url: "",
            }]
          : [],
      }
    } catch (e: any) {
      this.logger.error(`Delhivery createFulfillment error: ${e.message}`)
      throw e
    }
  }

  async cancelFulfillment(fulfillment: Record<string, any>): Promise<any> {
    const waybill = fulfillment.data?.waybill || fulfillment.data?.tracking_number
    if (!waybill) {
      return {}
    }

    try {
      const result = await this.client.cancelShipment(waybill)
      this.logger.info(`Delhivery shipment cancelled: waybill=${waybill}`)
      return result
    } catch (e: any) {
      this.logger.error(`Delhivery cancelFulfillment error: ${e.message}`)
      throw e
    }
  }

  async createReturnFulfillment(fulfillment: Record<string, any>): Promise<CreateFulfillmentResult> {
    // Delhivery reverse pickups are handled through their portal
    // Return a stub — merchant handles return logistics
    return {
      data: { carrier: "delhivery", type: "return" },
      labels: [],
    }
  }
}

export default DelhiveryFulfillmentService
