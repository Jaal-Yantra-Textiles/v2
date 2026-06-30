import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import EtsySyncAccount from "./models/etsy-sync-account"
import EtsySyncRecord from "./models/etsy-sync-record"
import EtsySyncSettings from "./models/etsy-sync-settings"
import EtsySyncBatch from "./models/etsy-sync-batch"
import { EtsyClient } from "../../lib/etsy-client"
import { EtsyPluginOptions, ShopInfo, TokenData } from "../../lib/types"

type ModuleOptions = EtsyPluginOptions & Record<string, any>

/**
 * Safely read a string property off the value Medusa passes as the 2nd
 * constructor arg. For a module nested inside a *plugin*, Medusa does not
 * forward the plugin `options` here — it passes the Awilix DI container proxy
 * instead, so a plain `options.keystring` access triggers
 * `Could not resolve 'keystring'`. The try/catch swallows that and lets us
 * fall back to env vars (which medusa-config maps these credentials from).
 */
function readOption(options: any, key: string): string | undefined {
  try {
    const value = options?.[key]
    return typeof value === "string" ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Translate any error raised while talking to Etsy (EtsyApiError from the
 * client, or a plain Error) into a MedusaError so it flows through Medusa's
 * HTTP error handler with a meaningful status code instead of a generic 500.
 */
function toMedusaError(err: any): MedusaError {
  if (err instanceof MedusaError) return err

  const status: number | undefined = err?.status
  const body: any = err?.body
  const message: string =
    body?.error_description || body?.error || err?.message || "Etsy request failed"

  // OAuth code reuse / expiry.
  if (status === 400 && body?.error === "invalid_grant") {
    return new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Etsy authorization expired or was already used. Please reconnect."
    )
  }
  // Account has no shop (our client raises this, or Etsy's "User does not own Shop").
  if (/shop/i.test(message) && /(no|not|own)/i.test(message)) {
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

function resolveEtsyOptions(options?: ModuleOptions): ModuleOptions {
  return {
    keystring: process.env.ETSY_KEYSTRING ?? readOption(options, "keystring") ?? "",
    sharedSecret:
      process.env.ETSY_SHARED_SECRET ?? readOption(options, "sharedSecret") ?? "",
    redirectUri:
      process.env.ETSY_REDIRECT_URI ??
      readOption(options, "redirectUri") ??
      "http://localhost:9000/app/settings/oauth/etsy/callback",
    scope:
      process.env.ETSY_SCOPE ??
      readOption(options, "scope") ??
      "listings_r listings_w listings_d shops_r",
  } as ModuleOptions
}

class EtsySyncService extends MedusaService({
  EtsySyncAccount,
  EtsySyncRecord,
  EtsySyncSettings,
  EtsySyncBatch,
}) {
  protected options_: ModuleOptions
  protected client_: EtsyClient | null = null

  constructor(container: any, options?: ModuleOptions) {
    super(...arguments)
    this.options_ = resolveEtsyOptions(options)
  }

  // ── Client ──────────────────────────────────────────────────────────────

  getClient(): EtsyClient {
    if (!this.client_) {
      this.client_ = new EtsyClient({
        keystring: this.options_.keystring,
        sharedSecret: this.options_.sharedSecret,
        redirectUri: this.options_.redirectUri,
        scope: this.options_.scope,
      })
    }
    return this.client_
  }

  getOptions(): ModuleOptions {
    return this.options_
  }

  // ── Account ─────────────────────────────────────────────────────────────

  async getActiveAccount() {
    const [account] = await this.listEtsySyncAccounts({
      is_active: true,
    } as any)
    return account ?? null
  }

  async saveAccount(token: TokenData, shop: ShopInfo) {
    const existing = await this.getActiveAccount()
    const payload = {
      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      user_id: token.access_token.split(".")[0],
      shop_url: shop.shop_url ?? null,
      currency: shop.currency ?? null,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_expires_at: new Date(token.retrieved_at + token.expires_in * 1000),
      shop_info: shop.raw,
      is_active: true,
    }
    if (existing) {
      return this.updateEtsySyncAccounts({
        id: existing.id,
        ...payload,
      } as any)
    }
    return this.createEtsySyncAccounts(payload as any)
  }

  async disconnect() {
    const account = await this.getActiveAccount()
    if (!account) return
    await this.updateEtsySyncAccounts({
      id: account.id,
      is_active: false,
      access_token: "",
      refresh_token: "",
    } as any)
  }

  /**
   * Ensure the access token is fresh (refresh proactively if it expires
   * within the next 5 minutes). Rotates the refresh token in the DB.
   */
  async ensureFreshToken(account?: any) {
    const acct = account ?? (await this.getActiveAccount())
    if (!acct) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Etsy account is not connected"
      )
    }
    const now = Date.now()
    const expiresAt = new Date(acct.token_expires_at).getTime()
    const fiveMinutes = 5 * 60 * 1000
    if (expiresAt - now > fiveMinutes) {
      return acct
    }
    try {
      const client = this.getClient()
      const token = await client.refreshAccessToken(acct.refresh_token)
      return this.updateEtsySyncAccounts({
        id: acct.id,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        token_expires_at: new Date(token.retrieved_at + token.expires_in * 1000),
      } as any)
    } catch (err) {
      throw toMedusaError(err)
    }
  }

  // ── Settings ────────────────────────────────────────────────────────────

  async getSettings() {
    const [settings] = await this.listEtsySyncSettings({}, { take: 1 } as any)
    if (settings) return settings
    return this.createEtsySyncSettings({} as any)
  }

  async updateSettings(data: any) {
    const settings = await this.getSettings()
    return this.updateEtsySyncSettings({ id: settings.id, ...data } as any)
  }

  // ── OAuth (PKCE verifier persisted on settings.pending_oauth) ──────────

  async startOAuth(): Promise<{ authorization_url: string; state: string }> {
    try {
      const { code_verifier, code_challenge } = EtsyClient.generatePkce()
      const state = crypto.randomUUID()
      await this.updateSettings({
        pending_oauth: {
          state,
          code_verifier,
          created_at: Date.now(),
        },
      })
      const client = this.getClient()
      return {
        authorization_url: client.getAuthorizationUrl(state, code_challenge),
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
        "Invalid or expired OAuth state. Please start the Etsy connection again."
      )
    }
    try {
      const client = this.getClient()
      const token = await client.exchangeCodeForToken(code, pending.code_verifier)
      const shop = await client.getShopByAccessToken(token.access_token)
      const account = await this.saveAccount(token, shop)
      await this.updateSettings({
        account_id: account.id,
        pending_oauth: null,
      })
      return { account, shop }
    } catch (err) {
      throw toMedusaError(err)
    }
  }

  // ── Sync records ────────────────────────────────────────────────────────

  async createSyncRecord(data: any) {
    return this.createEtsySyncRecords(data as any)
  }

  async updateSyncRecord(id: string, data: any) {
    return this.updateEtsySyncRecords({ id, ...data } as any)
  }

  async listSyncRecords(filters: any = {}, take = 20, skip = 0) {
    return this.listAndCountEtsySyncRecords(filters, {
      take,
      skip,
      order: { created_at: "DESC" },
    } as any)
  }
}

export default EtsySyncService
