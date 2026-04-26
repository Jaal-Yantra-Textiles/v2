const PROD_BASE = "https://express.api.dhl.com/mydhlapi"
const TEST_BASE = "https://express.api.dhl.com/mydhlapi/test"

export type DHLOptions = {
  api_key: string
  api_secret: string
  account_number?: string
  sandbox?: boolean
}

export class DHLClient {
  private baseUrl: string
  private authHeader: string
  private accountNumber: string

  constructor(options: DHLOptions) {
    this.baseUrl = options.sandbox ? TEST_BASE : PROD_BASE
    this.authHeader = `Basic ${Buffer.from(`${options.api_key}:${options.api_secret}`).toString("base64")}`
    this.accountNumber = options.account_number || ""
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
    }
  }

  async getRates(params: {
    origin_country: string
    origin_city: string
    origin_postal_code: string
    dest_country: string
    dest_city: string
    dest_postal_code: string
    weight: number // kg
    planned_shipping_date?: string
  }): Promise<any> {
    const qs = new URLSearchParams({
      accountNumber: this.accountNumber,
      originCountryCode: params.origin_country,
      originCityName: params.origin_city,
      originPostalCode: params.origin_postal_code,
      destinationCountryCode: params.dest_country,
      destinationCityName: params.dest_city,
      destinationPostalCode: params.dest_postal_code,
      weight: String(params.weight),
      length: "30",
      width: "20",
      height: "10",
      plannedShippingDate: params.planned_shipping_date || new Date().toISOString().split("T")[0],
      isCustomsDeclarable: "false",
      unitOfMeasurement: "metric",
    })

    const res = await fetch(`${this.baseUrl}/rates?${qs}`, {
      headers: this.headers(),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`DHL getRates failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  async createShipment(payload: {
    shipper: {
      name: string
      address: { line1: string; city: string; postal_code: string; country_code: string }
      phone: string
    }
    receiver: {
      name: string
      address: { line1: string; city: string; postal_code: string; country_code: string }
      phone: string
    }
    packages: Array<{ weight: number; dimensions?: { length: number; width: number; height: number } }>
    product_code?: string
    description?: string
  }): Promise<any> {
    const body = {
      plannedShippingDateAndTime: new Date().toISOString(),
      pickup: { isRequested: false },
      productCode: payload.product_code || "P",
      accounts: [{ typeCode: "shipper", number: this.accountNumber }],
      customerDetails: {
        shipperDetails: {
          postalAddress: {
            addressLine1: payload.shipper.address.line1,
            cityName: payload.shipper.address.city,
            postalCode: payload.shipper.address.postal_code,
            countryCode: payload.shipper.address.country_code,
          },
          contactInformation: {
            phone: payload.shipper.phone,
            companyName: payload.shipper.name,
            fullName: payload.shipper.name,
          },
        },
        receiverDetails: {
          postalAddress: {
            addressLine1: payload.receiver.address.line1,
            cityName: payload.receiver.address.city,
            postalCode: payload.receiver.address.postal_code,
            countryCode: payload.receiver.address.country_code,
          },
          contactInformation: {
            phone: payload.receiver.phone,
            companyName: payload.receiver.name,
            fullName: payload.receiver.name,
          },
        },
      },
      content: {
        packages: payload.packages.map((pkg, i) => ({
          weight: pkg.weight,
          dimensions: pkg.dimensions || { length: 30, width: 20, height: 10 },
          customerReferences: [{ value: `pkg-${i + 1}` }],
        })),
        isCustomsDeclarable: false,
        description: payload.description || "Textile goods",
        unitOfMeasurement: "metric",
      },
      outputImageProperties: {
        imageOptions: [{ typeCode: "label", templateName: "ECOM26_84_001" }],
      },
    }

    const res = await fetch(`${this.baseUrl}/shipments`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const respBody = await res.text()
      throw new Error(`DHL createShipment failed (${res.status}): ${respBody}`)
    }
    return res.json()
  }

  async track(trackingNumber: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/tracking?shipmentTrackingNumber=${trackingNumber}`,
      { headers: this.headers() }
    )
    if (!res.ok) throw new Error(`DHL tracking failed (${res.status})`)
    return res.json()
  }
}
