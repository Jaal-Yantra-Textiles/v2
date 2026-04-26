import { OAuthClient } from "../utils/oauth-client"

const PROD_TOKEN_URL = "https://apis.fedex.com/oauth/token"
const SANDBOX_TOKEN_URL = "https://apis-sandbox.fedex.com/oauth/token"

const PROD_BASE = "https://apis.fedex.com"
const SANDBOX_BASE = "https://apis-sandbox.fedex.com"

export type FedExOptions = {
  client_id: string
  client_secret: string
  account_number?: string
  sandbox?: boolean
}

export class FedExClient {
  private oauth: OAuthClient
  private baseUrl: string
  private accountNumber: string

  constructor(options: FedExOptions) {
    const tokenUrl = options.sandbox ? SANDBOX_TOKEN_URL : PROD_TOKEN_URL
    this.baseUrl = options.sandbox ? SANDBOX_BASE : PROD_BASE
    this.accountNumber = options.account_number || ""
    this.oauth = new OAuthClient(tokenUrl, options.client_id, options.client_secret)
  }

  private async headers(): Promise<Record<string, string>> {
    return this.oauth.authHeaders()
  }

  async getRates(params: {
    shipper: {
      postal_code: string
      country_code: string
      state?: string
    }
    recipient: {
      postal_code: string
      country_code: string
      state?: string
    }
    packages: Array<{ weight: number; dimensions?: { length: number; width: number; height: number } }>
    service_type?: string
  }): Promise<any> {
    const body = {
      accountNumber: { value: this.accountNumber },
      rateRequestControlParameters: { returnTransitTimes: true },
      requestedShipment: {
        shipper: {
          address: {
            postalCode: params.shipper.postal_code,
            countryCode: params.shipper.country_code,
            ...(params.shipper.state && { stateOrProvinceCode: params.shipper.state }),
          },
        },
        recipient: {
          address: {
            postalCode: params.recipient.postal_code,
            countryCode: params.recipient.country_code,
            ...(params.recipient.state && { stateOrProvinceCode: params.recipient.state }),
          },
        },
        ...(params.service_type && { serviceType: params.service_type }),
        pickupType: "DROPOFF_AT_FEDEX_LOCATION",
        requestedPackageLineItems: params.packages.map((pkg) => ({
          weight: {
            units: "KG",
            value: pkg.weight,
          },
          ...(pkg.dimensions && {
            dimensions: {
              length: pkg.dimensions.length,
              width: pkg.dimensions.width,
              height: pkg.dimensions.height,
              units: "CM",
            },
          }),
        })),
      },
    }

    const res = await fetch(`${this.baseUrl}/rate/v1/rates/quotes`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const respBody = await res.text()
      throw new Error(`FedEx getRates failed (${res.status}): ${respBody}`)
    }
    return res.json()
  }

  async createShipment(payload: {
    shipper: {
      name: string
      phone: string
      address: { line1: string; city: string; state: string; postal_code: string; country_code: string }
    }
    recipient: {
      name: string
      phone: string
      address: { line1: string; city: string; state: string; postal_code: string; country_code: string }
    }
    packages: Array<{ weight: number; dimensions?: { length: number; width: number; height: number } }>
    service_type?: string
    description?: string
  }): Promise<any> {
    const body = {
      accountNumber: { value: this.accountNumber },
      labelResponseOptions: "LABEL",
      requestedShipment: {
        shipper: {
          contact: {
            personName: payload.shipper.name,
            phoneNumber: payload.shipper.phone,
          },
          address: {
            streetLines: [payload.shipper.address.line1],
            city: payload.shipper.address.city,
            stateOrProvinceCode: payload.shipper.address.state,
            postalCode: payload.shipper.address.postal_code,
            countryCode: payload.shipper.address.country_code,
          },
        },
        recipients: [
          {
            contact: {
              personName: payload.recipient.name,
              phoneNumber: payload.recipient.phone,
            },
            address: {
              streetLines: [payload.recipient.address.line1],
              city: payload.recipient.address.city,
              stateOrProvinceCode: payload.recipient.address.state,
              postalCode: payload.recipient.address.postal_code,
              countryCode: payload.recipient.address.country_code,
            },
          },
        ],
        serviceType: payload.service_type || "FEDEX_GROUND",
        packagingType: "YOUR_PACKAGING",
        pickupType: "DROPOFF_AT_FEDEX_LOCATION",
        shippingChargesPayment: {
          paymentType: "SENDER",
          payor: {
            responsibleParty: { accountNumber: { value: this.accountNumber } },
          },
        },
        labelSpecification: {
          labelFormatType: "COMMON2D",
          imageType: "PDF",
          labelStockType: "PAPER_4X6",
        },
        requestedPackageLineItems: payload.packages.map((pkg, i) => ({
          sequenceNumber: i + 1,
          weight: { units: "KG", value: pkg.weight },
          ...(pkg.dimensions && {
            dimensions: {
              length: pkg.dimensions.length,
              width: pkg.dimensions.width,
              height: pkg.dimensions.height,
              units: "CM",
            },
          }),
          itemDescription: payload.description || "Textile goods",
        })),
      },
    }

    const res = await fetch(`${this.baseUrl}/ship/v1/shipments`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const respBody = await res.text()
      throw new Error(`FedEx createShipment failed (${res.status}): ${respBody}`)
    }
    return res.json()
  }

  async track(trackingNumber: string): Promise<any> {
    const body = {
      includeDetailedScans: true,
      trackingInfo: [
        {
          trackingNumberInfo: {
            trackingNumber,
          },
        },
      ],
    }

    const res = await fetch(`${this.baseUrl}/track/v1/trackingnumbers`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`FedEx tracking failed (${res.status})`)
    return res.json()
  }

  async cancelShipment(trackingNumber: string): Promise<any> {
    const body = {
      accountNumber: { value: this.accountNumber },
      trackingNumber,
    }

    const res = await fetch(`${this.baseUrl}/ship/v1/shipments/cancel`, {
      method: "PUT",
      headers: await this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const respBody = await res.text()
      throw new Error(`FedEx cancelShipment failed (${res.status}): ${respBody}`)
    }
    return res.json()
  }
}
