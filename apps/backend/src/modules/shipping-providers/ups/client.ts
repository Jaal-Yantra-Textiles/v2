import { OAuthClient } from "../utils/oauth-client"

const PROD_TOKEN_URL = "https://onlinetools.ups.com/security/v1/oauth/token"
const SANDBOX_TOKEN_URL = "https://wwwcie.ups.com/security/v1/oauth/token"

const PROD_BASE = "https://onlinetools.ups.com"
const SANDBOX_BASE = "https://wwwcie.ups.com"

export type UPSOptions = {
  client_id: string
  client_secret: string
  account_number?: string
  sandbox?: boolean
}

export class UPSClient {
  private oauth: OAuthClient
  private baseUrl: string
  private accountNumber: string

  constructor(options: UPSOptions) {
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
      name: string
      address: { city: string; state: string; postal_code: string; country_code: string }
    }
    ship_to: {
      name: string
      address: { city: string; state: string; postal_code: string; country_code: string }
    }
    packages: Array<{ weight: number; dimensions?: { length: number; width: number; height: number } }>
    service_code?: string
  }): Promise<any> {
    const body = {
      RateRequest: {
        Shipment: {
          Shipper: {
            Name: params.shipper.name,
            ShipperNumber: this.accountNumber,
            Address: {
              City: params.shipper.address.city,
              StateProvinceCode: params.shipper.address.state,
              PostalCode: params.shipper.address.postal_code,
              CountryCode: params.shipper.address.country_code,
            },
          },
          ShipTo: {
            Name: params.ship_to.name,
            Address: {
              City: params.ship_to.address.city,
              StateProvinceCode: params.ship_to.address.state,
              PostalCode: params.ship_to.address.postal_code,
              CountryCode: params.ship_to.address.country_code,
            },
          },
          ...(params.service_code && {
            Service: { Code: params.service_code },
          }),
          Package: params.packages.map((pkg) => ({
            PackagingType: { Code: "02" },
            PackageWeight: {
              UnitOfMeasurement: { Code: "KGS" },
              Weight: String(pkg.weight),
            },
            ...(pkg.dimensions && {
              Dimensions: {
                UnitOfMeasurement: { Code: "CM" },
                Length: String(pkg.dimensions.length),
                Width: String(pkg.dimensions.width),
                Height: String(pkg.dimensions.height),
              },
            }),
          })),
        },
      },
    }

    const res = await fetch(`${this.baseUrl}/api/rating/v1/Rate`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const respBody = await res.text()
      throw new Error(`UPS getRates failed (${res.status}): ${respBody}`)
    }
    return res.json()
  }

  async createShipment(payload: {
    shipper: {
      name: string
      phone: string
      address: { line1: string; city: string; state: string; postal_code: string; country_code: string }
    }
    ship_to: {
      name: string
      phone: string
      address: { line1: string; city: string; state: string; postal_code: string; country_code: string }
    }
    packages: Array<{ weight: number; dimensions?: { length: number; width: number; height: number } }>
    service_code?: string
    description?: string
  }): Promise<any> {
    const body = {
      ShipmentRequest: {
        Shipment: {
          Description: payload.description || "Textile goods",
          Shipper: {
            Name: payload.shipper.name,
            ShipperNumber: this.accountNumber,
            Phone: { Number: payload.shipper.phone },
            Address: {
              AddressLine: [payload.shipper.address.line1],
              City: payload.shipper.address.city,
              StateProvinceCode: payload.shipper.address.state,
              PostalCode: payload.shipper.address.postal_code,
              CountryCode: payload.shipper.address.country_code,
            },
          },
          ShipTo: {
            Name: payload.ship_to.name,
            Phone: { Number: payload.ship_to.phone },
            Address: {
              AddressLine: [payload.ship_to.address.line1],
              City: payload.ship_to.address.city,
              StateProvinceCode: payload.ship_to.address.state,
              PostalCode: payload.ship_to.address.postal_code,
              CountryCode: payload.ship_to.address.country_code,
            },
          },
          Service: { Code: payload.service_code || "03" },
          Package: payload.packages.map((pkg) => ({
            Packaging: { Code: "02" },
            PackageWeight: {
              UnitOfMeasurement: { Code: "KGS" },
              Weight: String(pkg.weight),
            },
            ...(pkg.dimensions && {
              Dimensions: {
                UnitOfMeasurement: { Code: "CM" },
                Length: String(pkg.dimensions.length),
                Width: String(pkg.dimensions.width),
                Height: String(pkg.dimensions.height),
              },
            }),
          })),
          PaymentInformation: {
            ShipmentCharge: [
              {
                Type: "01",
                BillShipper: { AccountNumber: this.accountNumber },
              },
            ],
          },
        },
        LabelSpecification: {
          LabelImageFormat: { Code: "PDF" },
          LabelStockSize: { Height: "6", Width: "4" },
        },
      },
    }

    const res = await fetch(`${this.baseUrl}/api/shipments/v1/ship`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const respBody = await res.text()
      throw new Error(`UPS createShipment failed (${res.status}): ${respBody}`)
    }
    return res.json()
  }

  async track(trackingNumber: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/api/track/v1/details/${trackingNumber}`,
      { headers: await this.headers() }
    )
    if (!res.ok) throw new Error(`UPS tracking failed (${res.status})`)
    return res.json()
  }

  async voidShipment(trackingNumber: string): Promise<any> {
    const res = await fetch(
      `${this.baseUrl}/api/shipments/v1/void/${trackingNumber}`,
      {
        method: "DELETE",
        headers: await this.headers(),
      }
    )
    if (!res.ok) {
      const respBody = await res.text()
      throw new Error(`UPS voidShipment failed (${res.status}): ${respBody}`)
    }
    return res.json()
  }
}
