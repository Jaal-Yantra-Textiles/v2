const PROD_BASE = "https://express.api.dhl.com/mydhlapi"
const TEST_BASE = "https://express.api.dhl.com/mydhlapi/test"

export type DHLOptions = {
  api_key: string
  api_secret: string
  account_number?: string
  sandbox?: boolean
  fetchImpl?: typeof fetch
}

export type DHLAddress = {
  line1: string
  city: string
  postal_code: string
  country_code: string
}

export type DHLParty = {
  name: string
  address: DHLAddress
  phone?: string
  email?: string
  company_name?: string
}

export type DHLLineItem = {
  description: string
  price: number
  quantity: number
  hs_code: string
  weight_kg: number
  manufacturer_country: string
}

export type DHLRateParams = {
  origin_country: string
  origin_city: string
  origin_postal_code: string
  dest_country: string
  dest_city: string
  dest_postal_code: string
  weight: number
  length?: number
  width?: number
  height?: number
  planned_shipping_date?: string
  is_customs_declarable?: boolean
}

export type DHLLandedCostParams = {
  shipper: DHLParty
  receiver: DHLParty
  weight: number
  length?: number
  width?: number
  height?: number
  product_code?: string
  currency_code: string
  declared_value: number
  items: Array<{
    name: string
    description?: string
    hs_code: string
    origin_country: string
    quantity: number
    unit_price: number
  }>
}

export type DHLCreateShipmentParams = {
  shipper: DHLParty
  receiver: DHLParty
  packages: Array<{ weight: number; length?: number; width?: number; height?: number }>
  product_code?: string
  description?: string
  is_customs_declarable?: boolean
  declared_value?: number
  declared_value_currency?: string
  items?: DHLLineItem[]
  invoice_number?: string
}

export class DHLClient {
  private baseUrl: string
  private authHeader: string
  private accountNumber: string
  private fetchImpl: typeof fetch

  constructor(options: DHLOptions) {
    this.baseUrl = options.sandbox ? TEST_BASE : PROD_BASE
    this.authHeader = `Basic ${Buffer.from(`${options.api_key}:${options.api_secret}`).toString("base64")}`
    this.accountNumber = options.account_number || ""
    this.fetchImpl = options.fetchImpl || fetch
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers || {}) },
    })
    const text = await res.text()
    let body: any
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = text
    }
    if (!res.ok) {
      const detail =
        typeof body === "string" ? body : body?.detail || body?.message || JSON.stringify(body)
      throw new Error(`DHL ${path.split("?")[0]} failed (${res.status}): ${detail}`)
    }
    return body as T
  }

  /**
   * Rating — account rates and available products for a one-piece shipment.
   */
  async getRates(params: DHLRateParams): Promise<any> {
    const qs = new URLSearchParams({
      accountNumber: this.accountNumber,
      originCountryCode: params.origin_country,
      originCityName: params.origin_city,
      originPostalCode: params.origin_postal_code,
      destinationCountryCode: params.dest_country,
      destinationCityName: params.dest_city,
      destinationPostalCode: params.dest_postal_code,
      weight: String(params.weight),
      length: String(params.length ?? 30),
      width: String(params.width ?? 20),
      height: String(params.height ?? 10),
      plannedShippingDate:
        params.planned_shipping_date || new Date().toISOString().split("T")[0],
      isCustomsDeclarable: String(params.is_customs_declarable ?? false),
      unitOfMeasurement: "metric",
    })
    return this.request<any>(`/rates?${qs}`)
  }

  /**
   * Product — lightweight capability check: which DHL Express products serve
   * the lane, without prices. Cheaper than rating when only serviceability is
   * needed. `totalPrice` is absent from this response.
   */
  async getProducts(params: Omit<DHLRateParams, "length" | "width" | "height"> & {
    length?: number
    width?: number
    height?: number
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
      length: String(params.length ?? 30),
      width: String(params.width ?? 20),
      height: String(params.height ?? 10),
      plannedShippingDate:
        params.planned_shipping_date || new Date().toISOString().split("T")[0],
      isCustomsDeclarable: String(params.is_customs_declarable ?? false),
      unitOfMeasurement: "metric",
    })
    return this.request<any>(`/products?${qs}`)
  }

  /**
   * Address validation — whether DHL serves a destination (or pickup origin).
   * `type` is "delivery" or "pickup". Returns the resolved service area.
   */
  async addressValidate(params: {
    type: "delivery" | "pickup"
    country_code: string
    postal_code: string
    city: string
    strict_validation?: boolean
  }): Promise<any> {
    const qs = new URLSearchParams({
      type: params.type,
      countryCode: params.country_code,
      postalCode: params.postal_code,
      cityName: params.city,
      strictValidation: String(params.strict_validation ?? false),
    })
    return this.request<any>(`/address-validate?${qs}`)
  }

  /**
   * Landed Cost — duties + taxes + freight for a customs-declarable consignment.
   * Unlike rating and shipment, the landed-cost schema is FLAT: customer details
   * carry postalCode/cityName/countryCode directly (no `postalAddress` wrapper),
   * and items carry a singular `commodityCode` (full import code) with `quantity`
   * as a bare number.
   */
  async landedCost(params: DHLLandedCostParams): Promise<any> {
    const body = {
      customerDetails: {
        shipperDetails: {
          postalCode: params.shipper.address.postal_code,
          cityName: params.shipper.address.city,
          countryCode: params.shipper.address.country_code,
          addressLine1: params.shipper.address.line1,
        },
        receiverDetails: {
          postalCode: params.receiver.address.postal_code,
          cityName: params.receiver.address.city,
          countryCode: params.receiver.address.country_code,
          addressLine1: params.receiver.address.line1,
        },
      },
      accounts: [{ typeCode: "shipper", number: this.accountNumber }],
      productCode: params.product_code || "P",
      localProductCode: params.product_code || "P",
      unitOfMeasurement: "metric",
      currencyCode: params.currency_code,
      isCustomsDeclarable: true,
      getCostBreakdown: true,
      packages: [
        {
          weight: params.weight,
          dimensions: {
            length: params.length ?? 30,
            width: params.width ?? 20,
            height: params.height ?? 10,
          },
        },
      ],
      items: params.items.map((item, i) => ({
        number: i + 1,
        name: item.name,
        description: item.description || item.name,
        manufacturerCountry: item.origin_country,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        unitPriceCurrencyCode: params.currency_code,
        commodityCode: item.hs_code,
      })),
    }
    return this.request<any>(`/landed-cost`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  async createShipment(payload: DHLCreateShipmentParams): Promise<any> {
    const isCustomsDeclarable = payload.is_customs_declarable ?? false

    const body: Record<string, any> = {
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
            phone: payload.shipper.phone || "",
            email: payload.shipper.email || "",
            companyName: payload.shipper.company_name || payload.shipper.name,
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
            phone: payload.receiver.phone || "",
            email: payload.receiver.email || "",
            companyName: payload.receiver.company_name || payload.receiver.name,
            fullName: payload.receiver.name,
          },
        },
      },
      content: {
        packages: payload.packages.map((pkg, i) => ({
          weight: pkg.weight,
          dimensions: {
            length: pkg.length ?? 30,
            width: pkg.width ?? 20,
            height: pkg.height ?? 10,
          },
          customerReferences: [{ value: `pkg-${i + 1}` }],
        })),
        isCustomsDeclarable,
        description: payload.description || "Textile goods",
        unitOfMeasurement: "metric",
      },
      outputImageProperties: {
        imageOptions: [{ typeCode: "label", templateName: "ECOM26_84_001" }],
      },
    }

    if (isCustomsDeclarable) {
      body.content.declaredValue = payload.declared_value ?? 0
      body.content.declaredValueCurrency = payload.declared_value_currency || "EUR"
      body.content.exportDeclaration = {
        lineItems: (payload.items || []).map((item, i) => ({
          number: i + 1,
          description: item.description,
          price: item.price,
          quantity: { value: item.quantity, unitOfMeasurement: "PCS" },
          commodityCodes: [{ typeCode: "outbound", value: item.hs_code }],
          weight: { netValue: item.weight_kg, grossValue: item.weight_kg },
          manufacturerCountry: item.manufacturer_country,
          exportReasonType: "permanent",
        })),
        invoice: {
          number: payload.invoice_number || `INV-${Date.now()}`,
          date: new Date().toISOString().split("T")[0],
        },
      }
    }

    return this.request<any>(`/shipments`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  async getShipment(shipmentTrackingNumber: string): Promise<any> {
    return this.request<any>(
      `/shipments/${encodeURIComponent(shipmentTrackingNumber)}`
    )
  }

  async createPickup(payload: {
    shipmentTrackingNumber: string
    pickupLocation: {
      name: string
      address: DHLAddress
      phone?: string
      email?: string
    }
    planned_pickup_date_and_time?: string
  }): Promise<any> {
    const body = {
      plannedPickupDateAndTime:
        payload.planned_pickup_date_and_time || new Date().toISOString(),
      shipmentTrackingNumbers: [payload.shipmentTrackingNumber],
      account: { typeCode: "shipper", number: this.accountNumber },
      pickupLocation: {
        name: payload.pickupLocation.name,
        phone: payload.pickupLocation.phone || "",
        email: payload.pickupLocation.email || "",
        address: {
          addressLine1: payload.pickupLocation.address.line1,
          cityName: payload.pickupLocation.address.city,
          postalCode: payload.pickupLocation.address.postal_code,
          countryCode: payload.pickupLocation.address.country_code,
        },
      },
      pickupDetails: { localCutoffDateAndTime: payload.planned_pickup_date_and_time || new Date().toISOString() },
    }
    return this.request<any>(`/pickups`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  async track(trackingNumber: string): Promise<any> {
    return this.request<any>(
      `/tracking?shipmentTrackingNumber=${encodeURIComponent(trackingNumber)}`
    )
  }
}