import { OAuthClient } from "../utils/oauth-client"

const TOKEN_URL = "https://welcome.api1.auspost.com.au/oauth/token"
const BASE_URL = "https://digitalapi.auspost.com.au"

export type AusPostOptions = {
  client_id: string
  client_secret: string
  account_number?: string
  sandbox?: boolean
}

export class AusPostClient {
  private oauth: OAuthClient
  private baseUrl: string
  private accountNumber: string

  constructor(options: AusPostOptions) {
    this.baseUrl = BASE_URL
    this.accountNumber = options.account_number || ""
    this.oauth = new OAuthClient(TOKEN_URL, options.client_id, options.client_secret)
  }

  private async headers(): Promise<Record<string, string>> {
    const authHeaders = await this.oauth.authHeaders()
    return {
      ...authHeaders,
      ...(this.accountNumber && { "Account-Number": this.accountNumber }),
    }
  }

  async getRates(params: {
    from: {
      suburb: string
      postcode: string
      state: string
      country?: string
    }
    to: {
      suburb: string
      postcode: string
      state: string
      country?: string
    }
    items: Array<{
      weight: number // kg
      length?: number
      width?: number
      height?: number
      product_id?: string
    }>
  }): Promise<any> {
    const body = {
      from: {
        suburb: params.from.suburb,
        postcode: params.from.postcode,
        state: params.from.state,
        country: params.from.country || "AU",
      },
      to: {
        suburb: params.to.suburb,
        postcode: params.to.postcode,
        state: params.to.state,
        country: params.to.country || "AU",
      },
      items: params.items.map((item) => ({
        weight: item.weight,
        length: item.length || 30,
        width: item.width || 20,
        height: item.height || 10,
        ...(item.product_id && { product_id: item.product_id }),
      })),
    }

    const res = await fetch(`${this.baseUrl}/shipping/v2/prices/shipments`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const respBody = await res.text()
      throw new Error(`AusPost getRates failed (${res.status}): ${respBody}`)
    }
    return res.json()
  }

  async createShipment(payload: {
    from: {
      name: string
      phone: string
      suburb: string
      postcode: string
      state: string
      lines: string[]
      country?: string
    }
    to: {
      name: string
      phone: string
      suburb: string
      postcode: string
      state: string
      lines: string[]
      country?: string
    }
    items: Array<{
      weight: number
      length?: number
      width?: number
      height?: number
      product_id?: string
      item_description?: string
    }>
  }): Promise<any> {
    const body = {
      shipments: [
        {
          from: {
            name: payload.from.name,
            phone: payload.from.phone,
            suburb: payload.from.suburb,
            postcode: payload.from.postcode,
            state: payload.from.state,
            lines: payload.from.lines,
            country: payload.from.country || "AU",
          },
          to: {
            name: payload.to.name,
            phone: payload.to.phone,
            suburb: payload.to.suburb,
            postcode: payload.to.postcode,
            state: payload.to.state,
            lines: payload.to.lines,
            country: payload.to.country || "AU",
          },
          items: payload.items.map((item) => ({
            weight: item.weight,
            length: item.length || 30,
            width: item.width || 20,
            height: item.height || 10,
            product_id: item.product_id || "7E55",
            item_description: item.item_description || "Textile goods",
          })),
        },
      ],
    }

    const res = await fetch(`${this.baseUrl}/shipping/v2/shipments`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const respBody = await res.text()
      throw new Error(`AusPost createShipment failed (${res.status}): ${respBody}`)
    }
    return res.json()
  }

  async getLabel(shipmentId: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/shipping/v2/labels?shipment_id=${shipmentId}`,
      { headers: await this.headers() }
    )
    if (!res.ok) {
      const respBody = await res.text()
      throw new Error(`AusPost getLabel failed (${res.status}): ${respBody}`)
    }
    return res.json()
  }

  async track(trackingId: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/shipping/v2/track?tracking_ids=${trackingId}`,
      { headers: await this.headers() }
    )
    if (!res.ok) throw new Error(`AusPost tracking failed (${res.status})`)
    return res.json()
  }
}
