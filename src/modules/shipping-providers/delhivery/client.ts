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

  async calculateShippingCost(params: {
    origin_pin: string
    destination_pin: string
    weight: number // grams
    payment_type?: "Pre-paid" | "COD"
  }): Promise<any> {
    const qs = new URLSearchParams({
      md: "S", // surface
      cgm: String(params.weight),
      o_pin: params.origin_pin,
      d_pin: params.destination_pin,
      ss: params.payment_type || "Pre-paid",
    })
    const res = await fetch(
      `${this.baseUrl}/api/kinko/v1/invoice/charges/.json?${qs}`,
      { headers: this.headers() }
    )
    if (!res.ok) throw new Error(`Delhivery rate calculation failed (${res.status})`)
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
