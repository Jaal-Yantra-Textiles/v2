import axios from "axios"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type EncryptionService from "../../../modules/encryption/service"
import type { GoogleService } from "../../../modules/social-provider/google-connection-service"
import { withGoogleRetry } from "../../../modules/social-provider/google-retry"

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
  "https://googleads.googleapis.com/v24/customers:listAccessibleCustomers"
const ADS_API_BASE = "https://googleads.googleapis.com/v24"
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
      const resources = await handler(input, container, logger)
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
  _container: any,
  logger?: Logger
): Promise<AccessibleResource[]> {
  try {
    const response = await withGoogleRetry(
      () =>
        axios.get(MERCHANT_ACCOUNTS_URL, {
          headers: { Authorization: `Bearer ${input.access_token}` },
          params: { pageSize: 250 },
        }),
      { label: "merchant.accounts.list", logger }
    )
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
  container: any,
  logger?: Logger
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
    const listResponse = await withGoogleRetry(
      () =>
        axios.get(ADS_LIST_CUSTOMERS_URL, {
          headers: {
            Authorization: `Bearer ${input.access_token}`,
            "developer-token": developerToken,
          },
        }),
      { label: "ads.listAccessibleCustomers", logger }
    )
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
  //
  // First pass: try with no login-customer-id (works for the user's own
  // accounts + manager accounts). Children of a manager will 403 here —
  // we fix that in the second pass using the manager → child map.
  const out: AccessibleResource[] = []
  for (const rn of cidResourceNames) {
    const cid = rn.split("/")[1]
    if (!cid) continue
    let label = cid
    let extra: Record<string, any> = { resource_name: rn }
    try {
      const gaql = await withGoogleRetry(
        () =>
          axios.post(
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
          ),
        { label: `ads.searchStream(${cid})`, logger, maxAttempts: 3 }
      )
      const row = extractFirstCustomer(gaql.data)
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

  // Second pass: discover manager → child links so we can stash
  // metadata.login_customer_id on every child. Without this header the
  // sync step gets a 403 on any account that's nested under an MCC.
  //
  // We only query customer_client on rows the first pass tagged as a
  // manager. customer_client returns ALL descendants under a manager,
  // including itself — we map children → this manager so the picker
  // can pass `settings.login_customer_id` straight through on bind.
  const childToManager = new Map<string, string>()
  const managers = out.filter((r) => r.metadata?.manager === true)
  for (const mgr of managers) {
    try {
      const response = await withGoogleRetry(
        () =>
          axios.post(
            `${ADS_API_BASE}/customers/${mgr.resource_id}/googleAds:searchStream`,
            {
              query:
                "SELECT customer_client.client_customer, customer_client.id, customer_client.level, customer_client.manager FROM customer_client WHERE customer_client.level <= 5",
            },
            {
              headers: {
                Authorization: `Bearer ${input.access_token}`,
                "developer-token": developerToken,
                "login-customer-id": mgr.resource_id,
                "Content-Type": "application/json",
              },
            }
          ),
        { label: `ads.customer_client(${mgr.resource_id})`, logger, maxAttempts: 2 }
      )
      const rows = extractAllRows(response.data)
      for (const r of rows) {
        const childRn =
          r.customerClient?.clientCustomer ||
          r.customer_client?.client_customer ||
          ""
        const childCid = childRn.split("/").pop() || ""
        if (!childCid || childCid === mgr.resource_id) continue
        // First manager wins (lowest-level link). Don't overwrite if a
        // higher MCC also lists this child — we want the most specific.
        if (!childToManager.has(childCid)) {
          childToManager.set(childCid, mgr.resource_id)
        }
      }
    } catch (e: any) {
      logger?.warn?.(
        `[google-ads] customer_client discovery failed for manager=${mgr.resource_id}: ${
          e.response?.data?.error?.message || e.message
        }`
      )
    }
  }

  // Attach login_customer_id on children + retry the hydrate for any
  // child that 403'd in the first pass (label stayed as bare CID).
  for (const r of out) {
    const loginCid = childToManager.get(r.resource_id)
    if (!loginCid) continue
    r.metadata = { ...(r.metadata || {}), login_customer_id: loginCid }
    if (r.resource_label === r.resource_id) {
      try {
        const gaql = await withGoogleRetry(
          () =>
            axios.post(
              `${ADS_API_BASE}/customers/${r.resource_id}/googleAds:searchStream`,
              {
                query:
                  "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1",
              },
              {
                headers: {
                  Authorization: `Bearer ${input.access_token}`,
                  "developer-token": developerToken,
                  "login-customer-id": loginCid,
                  "Content-Type": "application/json",
                },
              }
            ),
          { label: `ads.searchStream.retry(${r.resource_id})`, logger, maxAttempts: 2 }
        )
        const row = extractFirstCustomer(gaql.data)
        if (row) {
          r.resource_label = row.descriptiveName || r.resource_id
          r.metadata = {
            ...r.metadata,
            descriptive_name: row.descriptiveName,
            currency_code: row.currencyCode,
            time_zone: row.timeZone,
            manager: row.manager,
            test_account: row.testAccount,
          }
        }
      } catch {
        // Still bindable with the login_customer_id we just attached.
      }
    }
  }

  return out
}

function extractAllRows(data: any): any[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data.flatMap((chunk) => chunk?.results || [])
  }
  return data.results || []
}

function extractFirstCustomer(data: any): any {
  return extractAllRows(data)[0]?.customer ?? null
}

async function listSearchConsoleSites(
  input: ListAccessibleResourcesInput,
  _container: any,
  logger?: Logger
): Promise<AccessibleResource[]> {
  try {
    const response = await withGoogleRetry(
      () =>
        axios.get(GSC_SITES_URL, {
          headers: { Authorization: `Bearer ${input.access_token}` },
        }),
      { label: "search-console.sites.list", logger }
    )
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
  _container: any,
  logger?: Logger
): Promise<AccessibleResource[]> {
  try {
    // Business Profile's default quota is famously low (1 RPM per project).
    // Stretch the retries — a quota window can be 60s+, so allow waits up to
    // a minute and let Retry-After dominate when Google sends one.
    const response = await withGoogleRetry(
      () =>
        axios.get(BP_ACCOUNTS_URL, {
          headers: { Authorization: `Bearer ${input.access_token}` },
          params: { pageSize: 100 },
        }),
      {
        label: "business-profile.accounts.list",
        logger,
        baseDelayMs: 2000,
        maxDelayMs: 60_000,
      }
    )
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
