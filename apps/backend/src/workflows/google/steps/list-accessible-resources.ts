import axios from "axios"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type EncryptionService from "../../../modules/encryption/service"
import type { GoogleService } from "../../../modules/social-provider/google-connection-service"

export type ListAccessibleResourcesInput = {
  platform_id: string
  service: GoogleService
  /** Forwarded from the previous refresh step so we don't redundantly refresh. */
  access_token: string
}

export type AccessibleResource = {
  /** What we'll persist on social_platform_binding.resource_id */
  resource_id: string
  /** Human-readable label for the picker UI */
  resource_label: string
  /** Service-specific extras the binding might want to keep in `settings` */
  metadata: Record<string, any>
}

export type ListAccessibleResourcesOutput = {
  service: GoogleService
  resources: AccessibleResource[]
}

const MERCHANT_ACCOUNTS_URL = "https://merchantapi.googleapis.com/accounts/v1/accounts"
const ADS_LIST_CUSTOMERS_URL =
  "https://googleads.googleapis.com/v17/customers:listAccessibleCustomers"
const ADS_API_BASE = "https://googleads.googleapis.com/v17"
const GSC_SITES_URL = "https://searchconsole.googleapis.com/webmasters/v3/sites"
const BP_ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"

/**
 * Per-service lookup of resources the connected Google identity can bind.
 *
 *   merchant         → Merchant Center accounts the user has access to
 *   ads              → Google Ads accessible customers (+ descriptive name)
 *   search-console   → Verified Search Console properties
 *   business-profile → Business Profile accounts (locations come in a follow-up)
 *
 * Each branch returns a normalized `{resource_id, resource_label, metadata}`
 * tuple so the picker UI can render any service identically and POST a
 * binding without service-specific UX glue.
 */
export const listAccessibleResourcesStep = createStep(
  "list-accessible-resources-step",
  async (input: ListAccessibleResourcesInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

    const handler =
      input.service === "merchant"
        ? listMerchantAccounts
        : input.service === "ads"
          ? listAdsCustomers
          : input.service === "search-console"
            ? listSearchConsoleSites
            : input.service === "business-profile"
              ? listBusinessProfileAccounts
              : null

    if (!handler) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown Google service: ${input.service}`
      )
    }

    try {
      const resources = await handler(input, container)
      return new StepResponse<ListAccessibleResourcesOutput>({
        service: input.service,
        resources,
      })
    } catch (e: any) {
      logger?.warn?.(`[google] list-accessible-resources(${input.service}) failed: ${e.message}`)
      throw e
    }
  }
)

async function listMerchantAccounts(
  input: ListAccessibleResourcesInput,
  _container: any
): Promise<AccessibleResource[]> {
  try {
    const response = await axios.get(MERCHANT_ACCOUNTS_URL, {
      headers: { Authorization: `Bearer ${input.access_token}` },
      params: { pageSize: 250 },
    })
    const accounts = response.data?.accounts || []
    return accounts.map((a: any) => ({
      resource_id: String(a.accountId || a.name?.split("/").pop() || ""),
      resource_label: a.accountName || a.businessInformation?.name || a.name || "Unnamed",
      metadata: {
        name: a.name,
        adultContent: a.adultContent,
        testAccount: a.testAccount,
      },
    }))
  } catch (e: any) {
    const msg = e.response?.data?.error?.message || e.message
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Merchant accounts.list failed: ${msg}`
    )
  }
}

async function listAdsCustomers(
  input: ListAccessibleResourcesInput,
  container: any
): Promise<AccessibleResource[]> {
  const developerToken = await readDeveloperToken(input.platform_id, container)
  if (!developerToken) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Google Ads requires a developer token — set api_config.developer_token_encrypted on the platform"
    )
  }

  let cidResourceNames: string[] = []
  try {
    const listResponse = await axios.get(ADS_LIST_CUSTOMERS_URL, {
      headers: {
        Authorization: `Bearer ${input.access_token}`,
        "developer-token": developerToken,
      },
    })
    cidResourceNames = listResponse.data?.resourceNames || []
  } catch (e: any) {
    const msg = e.response?.data?.error?.message || e.message
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Google Ads listAccessibleCustomers failed: ${msg}`
    )
  }

  // Hydrate descriptive names via GAQL — best-effort per CID. A failure here
  // shouldn't drop the whole list; we surface the bare CID with no label
  // so the operator can still bind it.
  const out: AccessibleResource[] = []
  for (const rn of cidResourceNames) {
    const cid = rn.split("/")[1]
    if (!cid) continue
    let label = cid
    let extra: Record<string, any> = { resource_name: rn }
    try {
      const gaql = await axios.post(
        `${ADS_API_BASE}/customers/${cid}/googleAds:searchStream`,
        {
          query:
            "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1",
        },
        {
          headers: {
            Authorization: `Bearer ${input.access_token}`,
            "developer-token": developerToken,
            "Content-Type": "application/json",
          },
        }
      )
      const row = gaql.data?.[0]?.results?.[0]?.customer || gaql.data?.results?.[0]?.customer
      if (row) {
        label = row.descriptiveName || cid
        extra = {
          ...extra,
          descriptive_name: row.descriptiveName,
          currency_code: row.currencyCode,
          time_zone: row.timeZone,
          manager: row.manager,
          test_account: row.testAccount,
        }
      }
    } catch {
      // ignore; bare CID still bindable
    }
    out.push({ resource_id: cid, resource_label: label, metadata: extra })
  }

  return out
}

async function listSearchConsoleSites(
  input: ListAccessibleResourcesInput,
  _container: any
): Promise<AccessibleResource[]> {
  try {
    const response = await axios.get(GSC_SITES_URL, {
      headers: { Authorization: `Bearer ${input.access_token}` },
    })
    const sites = response.data?.siteEntry || []
    return sites.map((s: any) => ({
      resource_id: s.siteUrl,
      resource_label: s.siteUrl,
      metadata: { permissionLevel: s.permissionLevel },
    }))
  } catch (e: any) {
    const msg = e.response?.data?.error?.message || e.message
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Search Console sites.list failed: ${msg}`
    )
  }
}

async function listBusinessProfileAccounts(
  input: ListAccessibleResourcesInput,
  _container: any
): Promise<AccessibleResource[]> {
  try {
    const response = await axios.get(BP_ACCOUNTS_URL, {
      headers: { Authorization: `Bearer ${input.access_token}` },
      params: { pageSize: 100 },
    })
    const accounts = response.data?.accounts || []
    return accounts.map((a: any) => ({
      resource_id: a.name, // "accounts/{accountId}"
      resource_label: a.accountName || a.name,
      metadata: {
        type: a.type,
        verificationState: a.verificationState,
        vettedState: a.vettedState,
      },
    }))
  } catch (e: any) {
    const msg = e.response?.data?.error?.message || e.message
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Business Profile accounts.list failed: ${msg}`
    )
  }
}

async function readDeveloperToken(
  platformId: string,
  container: any
): Promise<string | null> {
  const socials = container.resolve(SOCIALS_MODULE)
  const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService
  const [platform] = await socials.listSocialPlatforms({ id: platformId }, { take: 1 })
  if (!platform) return null
  const apiConfig = (platform.api_config || {}) as Record<string, any>
  if (!apiConfig.developer_token_encrypted) return null
  try {
    return encryption.decrypt(apiConfig.developer_token_encrypted)
  } catch {
    return null
  }
}
