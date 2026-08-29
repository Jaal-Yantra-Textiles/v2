const PROD_BASE = "https://express.api.dhl.com/mydhlapi"
const TEST_BASE = "https://express.api.dhl.com/mydhlapi/test"
/** DHL's mock server — fixed test data, no account-authorization gating. */
const MOCK_BASE = "https://api-mock.dhl.com/mydhlapi"

/**
 * Format a Date the way DHL's shipment/pickup schema demands:
 * `2010-02-11T17:10:09 GMT+01:00` — NO `Z`, NO fractional seconds, an explicit
 * `GMT` offset. `new Date().toISOString()` (`...T..:..Z`) is rejected by the
 * test gateway with `#/plannedShippingDateAndTime is not well formatted`.
 */
export function dhlDateTime(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const offsetMin = -date.getTimezoneOffset() // minutes EAST of UTC
  const sign = offsetMin >= 0 ? "+" : "-"
  const abs = Math.abs(offsetMin)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    ` GMT${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

export type DHLOptions = {
  api_key: string
  api_secret: string
  account_number?: string
  /** Use the sandbox/test gateway (`/mydhlapi/test`). */
  sandbox?: boolean
  /** Use DHL's mock server (fixed test data) — takes precedence over `sandbox`. */
  mock?: boolean
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

/** How DHL estimates the tariff rate for a (usually partial) HS code. */
export type DHLTariffRateType =
  | "default_rate"
  | "derived_rate"
  | "highest_rate"
  | "center_rate"
  | "lowest_rate"
  | "preferential_rate"

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
    /** Net weight per unit in kg. */
    weight: number
    /**
     * REQUIRED in practice when the HS code is partial (6-digit or less): the
     * GTS calculator cannot estimate a ballpark duty without knowing which end
     * of the range to quote. Defaults to `highest_rate` (over- rather than
     * under-quote a liability).
     */
    estimated_tariff_rate_type?: DHLTariffRateType
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

export type DHLPickupParams = {
  planned_pickup_date_and_time?: string
  /** Latest time the location can dispatch (HH:MM). */
  close_time?: string
  location?: string
  location_type?: "business" | "residence"
  /** The party DHL collects FROM — required. */
  shipper: DHLParty
  receiver?: DHLParty
  remark?: string
  special_instructions?: Array<{ value: string; type_code?: string }>
  shipments: Array<{
    product_code: string
    is_customs_declarable: boolean
    packages: Array<{ weight: number; length?: number; width?: number; height?: number }>
    shipment_tracking_number?: string
    declared_value?: number
    declared_value_currency?: string
  }>
}

export class DHLClient {
  private baseUrl: string
  private authHeader: string
  private accountNumber: string
  private fetchImpl: typeof fetch

  constructor(options: DHLOptions) {
    this.baseUrl = options.mock
      ? MOCK_BASE
      : options.sandbox
        ? TEST_BASE
        : PROD_BASE
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
      const parts: string[] = []
      const head =
        typeof body === "string" ? body : body?.detail || body?.message || ""
      if (head) parts.push(head)
      // DHL 400/422 errors bury the actual field problems in `additionalDetails`
      // (an array of strings or `{message}` objects). Without them, "Multiple
      // problems found, see Additional Details" tells you nothing.
      const additional = body?.additionalDetails
      if (Array.isArray(additional)) {
        for (const a of additional) {
          if (typeof a === "string") parts.push(a)
          else if (a?.message) parts.push(a.message)
        }
      }
      const detail = parts.length
        ? parts.join(" | ")
        : typeof body === "string"
          ? body
          : JSON.stringify(body)
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
        weight: item.weight,
        weightUnitOfMeasurement: "metric",
        // With a partial (≤6-digit) HS code the GTS calculator has no single
        // duty figure — without this it fails with a misleading
        // "NetWeight KGM MEASUREMENT VALUE IS MISSING". `highest_rate` is the
        // conservative default: better to over-quote than under-quote a duty.
        estimatedTariffRateType: item.estimated_tariff_rate_type || "highest_rate",
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
      plannedShippingDateAndTime: dhlDateTime(),
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

  /**
   * Documents for a shipment — DHL's "Get Image" service returns the label,
   * waybill and commercial/customs invoice it produced at creation, base64.
   *
   * `typeCode` is one of DHL's document types (`waybill`,
   * `commercial-invoice`, `customs-entry`, `transport-accompanying-document`,
   * `generic-entry-summary`, `dhl-issued-proforma-invoice`). `pickupYearAndMonth`
   * (`YYYY-MM`) and an account number are REQUIRED by DHL to locate the images.
   * There is NO `GET /shipments/{id}/documents` endpoint in the DHL Express API.
   */
  async getShipmentImage(
    shipmentTrackingNumber: string,
    opts: {
      typeCode: string
      shipperAccountNumber?: string
      pickupYearAndMonth?: string
      encodingFormat?: "pdf" | "tiff"
      allInOnePDF?: boolean
      compressedPackage?: boolean
    }
  ): Promise<any> {
    const qs = new URLSearchParams({
      typeCode: opts.typeCode,
      shipperAccountNumber: opts.shipperAccountNumber || this.accountNumber,
    })
    if (opts.pickupYearAndMonth) qs.set("pickupYearAndMonth", opts.pickupYearAndMonth)
    if (opts.encodingFormat) qs.set("encodingFormat", opts.encodingFormat)
    if (opts.allInOnePDF !== undefined) qs.set("allInOnePDF", String(opts.allInOnePDF))
    if (opts.compressedPackage !== undefined) qs.set("compressedPackage", String(opts.compressedPackage))
    return this.request<any>(
      `/shipments/${encodeURIComponent(shipmentTrackingNumber)}/get-image?${qs}`
    )
  }

  /**
   * Book a pickup. Matches `supermodelIoLogisticsExpressPickupRequest`: `accounts`
   * is an ARRAY (not a singular `account`), the collection party is
   * `customerDetails.shipperDetails`, and the shipment(s) to collect live under
   * `shipmentDetails[]` (which requires `productCode`, `isCustomsDeclarable`,
   * `unitOfMeasurement` and `packages` even when the AWB is already known).
   */
  async createPickup(payload: DHLPickupParams): Promise<any> {
    const body: Record<string, any> = {
      plannedPickupDateAndTime:
        payload.planned_pickup_date_and_time || dhlDateTime(),
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
      },
      shipmentDetails: payload.shipments.map((s) => {
        const detail: Record<string, any> = {
          productCode: s.product_code,
          isCustomsDeclarable: s.is_customs_declarable,
          unitOfMeasurement: "metric",
          packages: s.packages.map((p) => ({
            weight: p.weight,
            dimensions: {
              length: p.length ?? 30,
              width: p.width ?? 20,
              height: p.height ?? 10,
            },
          })),
        }
        if (s.shipment_tracking_number) {
          detail.shipmentTrackingNumber = s.shipment_tracking_number
        }
        if (s.declared_value !== undefined) {
          detail.declaredValue = s.declared_value
          detail.declaredValueCurrency = s.declared_value_currency || "EUR"
        }
        return detail
      }),
    }

    if (payload.close_time) body.closeTime = payload.close_time
    if (payload.location) body.location = payload.location
    if (payload.location_type) body.locationType = payload.location_type
    if (payload.remark) body.remark = payload.remark
    if (payload.receiver) {
      body.customerDetails.receiverDetails = {
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
      }
    }
    if (payload.special_instructions?.length) {
      body.specialInstructions = payload.special_instructions.map((si) => ({
        value: si.value,
        ...(si.type_code ? { typeCode: si.type_code } : {}),
      }))
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

/** A DHL document reduced to what Medusa can actually download/render. */
export type DHLDocument = {
  typeCode: string
  /** The document's format ("pdf", "tiff", "png", "zip") — DHL's own vocabulary. */
  contentType: string
  /** base64 (DHL returns label/invoice content as base64). */
  content: string
}

/**
 * Normalize DHL's document payloads onto one flat shape.
 *
 * DHL returns documents in different envelopes depending on the call — the
 * create-shipment response carries a bare `documents[]` (fields `imageFormat`,
 * `typeCode`, `content`), while the "Get Image" service returns
 * `{ documents: [{ typeCode, encodingFormat, content }] }`. The FORMAT field
 * name differs per call (`imageFormat` vs `encodingFormat`), so both are read.
 * Rows with no base64 `content` are dropped — a document reference with nothing
 * to download is worse than an empty list. Pure & exported for unit testing.
 */
export function normalizeDhlDocuments(res: any): DHLDocument[] {
  const docs = Array.isArray(res)
    ? res
    : res?.documents ?? res?.shipments?.[0]?.documents ?? []
  if (!Array.isArray(docs)) return []
  return docs
    .filter((d: any) => d && typeof d.content === "string" && d.content.length)
    .map((d: any) => ({
      typeCode: String(d.typeCode || d.documentType || ""),
      contentType: String(
        d.contentType || d.encodingFormat || d.imageFormat || "pdf"
      ).toLowerCase(),
      content: d.content,
    }))
}