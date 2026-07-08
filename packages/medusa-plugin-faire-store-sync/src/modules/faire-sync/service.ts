import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import FaireSyncAccount from "./models/faire-sync-account"
import FaireSyncRecord from "./models/faire-sync-record"
import FaireSyncSettings from "./models/faire-sync-settings"
import FaireSyncBatch from "./models/faire-sync-batch"
import FaireWebhookEvent from "./models/faire-webhook-event"
import FaireOrder from "./models/faire-order"
import { FaireClient } from "../../lib/faire-client"
import { FairePluginOptions, BrandInfo, TokenData } from "../../lib/types"

type ModuleOptions = FairePluginOptions & Record<string, any>

function readOption(options: any, key: string): string | undefined {
  try {
    const value = options?.[key]
    return typeof value === "string" ? value : undefined
  } catch {
    return undefined
  }
}

function toMedusaError(err: any): MedusaError {
  if (err instanceof MedusaError) return err

  const status: number | undefined = err?.status
  const body: any = err?.body
  const message: string =
    body?.error_description || body?.error || err?.message || "Faire request failed"

  if (status === 400 && /invalid_grant|invalid code|already used/i.test(message)) {
    return new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Faire authorization expired or was already used. Please reconnect."
    )
  }
  if (/brand/i.test(message) && /(no|not|own)/i.test(message)) {
    return new MedusaError(MedusaError.Types.NOT_FOUND, message)
  }
  if (status === 401 || status === 403) {
    return new MedusaError(MedusaError.Types.NOT_ALLOWED, message)
  }
  if (status === 404) {
    return new MedusaError(MedusaError.Types.NOT_FOUND, message)
  }
  if (status === 400 || status === 422) {
    return new MedusaError(MedusaError.Types.INVALID_DATA, message)
  }
  return new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)
}

function resolveFaireOptions(options?: ModuleOptions): ModuleOptions {
  return {
    clientId: process.env.FAIRE_CLIENT_ID ?? readOption(options, "clientId") ?? "",
    clientSecret:
      process.env.FAIRE_CLIENT_SECRET ?? readOption(options, "clientSecret") ?? "",
    redirectUri:
      process.env.FAIRE_REDIRECT_URI ??
      readOption(options, "redirectUri") ??
      "http://localhost:9000/app/settings/oauth/faire/callback",
    apiBase: process.env.FAIRE_API_BASE ?? readOption(options, "apiBase"),
    authUrl: process.env.FAIRE_AUTH_URL ?? readOption(options, "authUrl"),
    tokenUrl: process.env.FAIRE_TOKEN_URL ?? readOption(options, "tokenUrl"),
    scope: process.env.FAIRE_SCOPE ?? readOption(options, "scope") ?? "",
    webhookSecret:
      process.env.FAIRE_WEBHOOK_SECRET ?? readOption(options, "webhookSecret") ?? "",
  } as ModuleOptions
}

class FaireSyncService extends MedusaService({
  FaireSyncAccount,
  FaireSyncRecord,
  FaireSyncSettings,
  FaireSyncBatch,
  FaireWebhookEvent,
  FaireOrder,
}) {
  protected options_: ModuleOptions
  protected client_: FaireClient | null = null

  constructor(container: any, options?: ModuleOptions) {
    super(...arguments)
    this.options_ = resolveFaireOptions(options)
  }

  getClient(): FaireClient {
    if (!this.client_) {
      this.client_ = new FaireClient(this.options_)
    }
    return this.client_
  }

  getOptions(): ModuleOptions {
    return this.options_
  }

  async getActiveAccount() {
    const [account] = await this.listFaireSyncAccounts({
      is_active: true,
    } as any)
    return account ?? null
  }

  async saveAccount(token: TokenData, brand: BrandInfo) {
    const existing = await this.getActiveAccount()
    const expiresAt =
      token.expires_in != null
        ? new Date(token.retrieved_at + token.expires_in * 1000)
        : null
    const payload = {
      brand_id: brand.brand_id,
      brand_name: brand.brand_name,
      currency: brand.currency ?? null,
      country: brand.country ?? null,
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? null,
      token_expires_at: expiresAt,
      brand_info: brand.raw,
      is_active: true,
    }
    if (existing) {
      return this.updateFaireSyncAccounts({
        id: existing.id,
        ...payload,
      } as any)
    }
    return this.createFaireSyncAccounts(payload as any)
  }

  async disconnect() {
    const account = await this.getActiveAccount()
    if (!account) return
    await this.updateFaireSyncAccounts({
      id: account.id,
      is_active: false,
      access_token: "",
      refresh_token: null,
    } as any)
  }

  async ensureFreshToken(account?: any) {
    const acct = account ?? (await this.getActiveAccount())
    if (!acct) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Faire account is not connected"
      )
    }
    if (!acct.token_expires_at) {
      return acct
    }
    const now = Date.now()
    const expiresAt = new Date(acct.token_expires_at).getTime()
    const fiveMinutes = 5 * 60 * 1000
    if (expiresAt - now > fiveMinutes) {
      return acct
    }
    if (!acct.refresh_token) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Faire access token has expired. Please reconnect your Faire account."
      )
    }
    try {
      const client = this.getClient()
      const token = await client.refreshAccessToken(acct.refresh_token)
      return this.updateFaireSyncAccounts({
        id: acct.id,
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? acct.refresh_token,
        token_expires_at:
          token.expires_in != null
            ? new Date(token.retrieved_at + token.expires_in * 1000)
            : null,
      } as any)
    } catch (err) {
      throw toMedusaError(err)
    }
  }

  async getSettings() {
    const [settings] = await this.listFaireSyncSettings({}, { take: 1 } as any)
    if (settings) return settings
    return this.createFaireSyncSettings({} as any)
  }

  async updateSettings(data: any) {
    const settings = await this.getSettings()
    return this.updateFaireSyncSettings({ id: settings.id, ...data } as any)
  }

  async startOAuth(): Promise<{ authorization_url: string; state: string }> {
    try {
      const state = crypto.randomUUID()
      await this.updateSettings({
        pending_oauth: {
          state,
          created_at: Date.now(),
        },
      })
      const client = this.getClient()
      return {
        authorization_url: client.getAuthorizationUrl(state),
        state,
      }
    } catch (err) {
      throw toMedusaError(err)
    }
  }

  async completeOAuth(code: string, state: string) {
    const settings = await this.getSettings()
    const pending: any = settings.pending_oauth
    if (!pending || pending.state !== state) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Invalid or expired OAuth state. Please start the Faire connection again."
      )
    }
    try {
      const client = this.getClient()
      const token = await client.exchangeCodeForToken(code)
      const brand = await client.getBrand(token.access_token)
      const account = await this.saveAccount(token, brand)
      await this.updateSettings({
        account_id: account.id,
        default_brand_id: brand.brand_id,
        pending_oauth: null,
      })
      return { account, brand }
    } catch (err) {
      throw toMedusaError(err)
    }
  }

  async createSyncRecord(data: any) {
    return this.createFaireSyncRecords(data as any)
  }

  async updateSyncRecord(id: string, data: any) {
    return this.updateFaireSyncRecords({ id, ...data } as any)
  }

  async listSyncRecords(filters: any = {}, take = 20, skip = 0) {
    return this.listAndCountFaireSyncRecords(filters, {
      take,
      skip,
      order: { created_at: "DESC" },
    } as any)
  }
}

export default FaireSyncService
