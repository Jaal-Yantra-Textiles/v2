const STAGING_BASE = "https://staging-express.delhivery.com"
const PROD_BASE = "https://track.delhivery.com"

export type DelhiveryOptions = {
  api_token: string
  sandbox?: boolean
}

export class DelhiveryClient {
  private baseUrl: string
  private token: string

  constructor(options: DelhiveryOptions) {
    this.token = options.api_token
    this.baseUrl = options.sandbox ? STAGING_BASE : PROD_BASE
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Token ${this.token}`,
      "Content-Type": "application/json",
    }
  }

  async checkServiceability(pincode: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/c/api/pin-code/check/?filter_codes=${pincode}`,
      { headers: this.headers() }
    )
    if (!res.ok) throw new Error(`Delhivery serviceability check failed (${res.status})`)
    return res.json()
  }

  /**
   * Calculate shipping cost using Delhivery Kinko Invoice API.
   *
   * Docs: https://delhivery-express-api-doc.readme.io/reference/invoice-shipping-charge-api
   *
   * Parameters:
   *   md   — Billing mode: "E" (Express) or "S" (Surface)
   *   cgm  — Chargeable weight in grams (integer > 0)
   *   o_pin — Origin pincode (6-digit Indian pincode)
   *   d_pin — Destination pincode (6-digit Indian pincode)
   *   ss   — Shipment status: "Delivered", "RTO", or "DTO"
   *
   * Rate limit: 40 requests/minute
   */
  async calculateShippingCost(params: {
    origin_pin: string
    destination_pin: string
    weight: number // grams
    mode?: "S" | "E"
  }): Promise<any> {
    // Ensure weight is a positive integer
    const weight = Math.max(1, Math.round(params.weight))

    const qs = new URLSearchParams({
      md: params.mode || "S",
      cgm: String(weight),
      o_pin: params.origin_pin,
      d_pin: params.destination_pin,
      ss: "Delivered",
    })

    const url = `${this.baseUrl}/api/kinko/v1/invoice/charges/.json?${qs}`
    console.log(`[Delhivery] Rate API request: ${url}`)

    const res = await fetch(url, { headers: this.headers() })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[Delhivery] Rate API ${res.status}: ${body}`)
      throw new Error(`Delhivery rate calculation failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  async fetchWaybill(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/waybill/api/fetch/`, {
      headers: this.headers(),
    })
    if (!res.ok) throw new Error(`Delhivery waybill fetch failed (${res.status})`)
    const text = await res.text()
    return text.trim()
  }

  async createShipment(shipment: {
    waybill: string
    name: string
    phone: string
    address: string
    city: string
    pin: string
    state: string
    country?: string
    order_id: string
    payment_mode: "Pre-paid" | "COD"
    product_desc?: string
    weight: number // grams
    cod_amount?: number
    seller_name?: string
    seller_address?: string
    seller_city?: string
    seller_pin?: string
    seller_state?: string
  }): Promise<any> {
    const payload = {
      shipments: [
        {
          waybill: shipment.waybill,
          name: shipment.name,
          phone: shipment.phone,
          add: shipment.address,
          city: shipment.city,
          pin: shipment.pin,
          state: shipment.state,
          country: shipment.country || "India",
          order: shipment.order_id,
          payment_mode: shipment.payment_mode,
          products_desc: shipment.product_desc || "",
          weight: shipment.weight,
          cod_amount: shipment.cod_amount || 0,
          seller_name: shipment.seller_name || "",
          seller_add: shipment.seller_address || "",
          seller_city: shipment.seller_city || "",
          seller_pin: shipment.seller_pin || "",
          seller_state: shipment.seller_state || "",
        },
      ],
      pickup_location: {
        name: shipment.seller_name || "Default",
      },
    }

    const form = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`

    const res = await fetch(`${this.baseUrl}/api/cmu/create.json`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Delhivery shipment creation failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  async trackShipment(waybill: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/packages/json/?waybill=${waybill}`,
      { headers: this.headers() }
    )
    if (!res.ok) throw new Error(`Delhivery tracking failed (${res.status})`)
    return res.json()
  }

  async getLabel(waybill: string): Promise<string> {
    const res = await fetch(
      `${this.baseUrl}/api/p/packing_slip?wbns=${waybill}`,
      { headers: this.headers() }
    )
    if (!res.ok) throw new Error(`Delhivery label fetch failed (${res.status})`)
    return res.url // Returns PDF URL
  }

  async cancelShipment(waybill: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/p/edit`, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `waybill=${waybill}&cancellation=true`,
    })
    if (!res.ok) throw new Error(`Delhivery cancellation failed (${res.status})`)
    return res.json()
  }
}
