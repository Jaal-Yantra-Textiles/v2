import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import FaireSyncAccount from "./models/faire-sync-account"
import FaireSyncRecord from "./models/faire-sync-record"
import FaireSyncSettings from "./models/faire-sync-settings"
import FaireSyncBatch from "./models/faire-sync-batch"
import FaireOrder from "./models/faire-order"
import { FaireClient } from "../../lib/faire-client"
import { encryptSecret, decryptSecret } from "../../lib/crypto"
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
  if (/already installed/i.test(message)) {
    return new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This Faire app already has an active connection. Disconnect it here first, or uninstall the app from your Faire account (Settings → Apps), then connect again."
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
  const authMode =
    (process.env.FAIRE_AUTH_MODE as ModuleOptions["authMode"]) ??
    readOption(options, "authMode") ??
    "oauth"
  return {
    authMode: authMode === "apiKey" ? "apiKey" : "oauth",
    clientId: process.env.FAIRE_APP_ID ?? readOption(options, "clientId") ?? "",
    clientSecret:
      process.env.FAIRE_APP_SECRET ?? readOption(options, "clientSecret") ?? "",
    redirectUri:
      process.env.FAIRE_REDIRECT_URI ??
      readOption(options, "redirectUri") ??
      "http://localhost:9000/app/settings/oauth/faire/callback",
    apiBase: process.env.FAIRE_API_BASE ?? readOption(options, "apiBase"),
    authUrl: process.env.FAIRE_AUTH_URL ?? readOption(options, "authUrl"),
    tokenUrl: process.env.FAIRE_TOKEN_URL ?? readOption(options, "tokenUrl"),
    scope: process.env.FAIRE_SCOPE ?? readOption(options, "scope") ?? "",
    accessToken:
      process.env.FAIRE_ACCESS_TOKEN ?? readOption(options, "accessToken") ?? "",
  } as ModuleOptions
}

class FaireSyncService extends MedusaService({
  FaireSyncAccount,
  FaireSyncRecord,
  FaireSyncSettings,
  FaireSyncBatch,
  FaireOrder,
}) {
  protected options_: ModuleOptions
  protected client_: FaireClient | null = null

  constructor(container: any, options?: ModuleOptions) {
    super(...arguments)
    this.options_ = resolveFaireOptions(options)
  }

  /**
   * Build a Faire client. Pass `authModeOverride` (e.g. an account's `auth_mode`)
   * to force the auth header for that connection type; without it, the plugin's
   * configured default is used (cached).
   */
  getClient(authModeOverride?: "oauth" | "apiKey"): FaireClient {
    if (authModeOverride) {
      return new FaireClient({ ...this.options_, authMode: authModeOverride })
    }
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

  /**
   * Return a shallow copy of an account with its at-rest secrets decrypted, for
   * use when calling the Faire API. Tokens are stored encrypted (AES-256-GCM);
   * callers that make API requests must go through this / `ensureFreshToken`.
   */
  private withDecryptedTokens<T extends { access_token?: any; refresh_token?: any }>(
    account: T | null
  ): T | null {
    if (!account) return account
    return {
      ...account,
      access_token: decryptSecret(account.access_token),
      refresh_token: account.refresh_token
        ? decryptSecret(account.refresh_token)
        : account.refresh_token,
    }
  }

  async saveAccount(
    token: TokenData,
    brand: BrandInfo,
    authMode: "oauth" | "apiKey" = "oauth"
  ) {
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
      auth_mode: authMode,
      access_token: encryptSecret(token.access_token),
      refresh_token: encryptSecret(token.refresh_token ?? null),
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
    // Revoke on Faire's side FIRST. Faire allows only one active OAuth token per
    // (app, brand); if we only clear locally, a later reconnect fails with 400
    // "Application is already installed via an active OAuth access token".
    // Best-effort: a failed revoke must not block local disconnect.
    try {
      const accessToken = decryptSecret((account as any).access_token)
      // Only OAuth tokens are revocable; a brand-issued API key is not.
      if (accessToken && (account as any).auth_mode !== "apiKey") {
        await this.getClient("oauth").revokeToken(accessToken)
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(
        "[faire-sync] Faire token revoke failed on disconnect (clearing locally anyway):",
        err?.message
      )
    }
    await this.updateFaireSyncAccounts({
      id: account.id,
      is_active: false,
      access_token: "",
      refresh_token: null,
    } as any)
  }

  /**
   * Resolve an account whose access/refresh tokens are DECRYPTED and non-expired,
   * refreshing against Faire if needed. All Faire API callers must use this — the
   * tokens are stored encrypted at rest, so a raw account row is unusable.
   */
  async ensureFreshToken(account?: any) {
    const acct = account ?? (await this.getActiveAccount())
    if (!acct) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Faire account is not connected"
      )
    }
    // API keys never expire and have no OAuth refresh flow — short-circuit
    // before touching the refresh path. Without this, a stray token_expires_at
    // on an apiKey account would drive the OAuth token endpoint and 400 hourly.
    if (acct.auth_mode === "apiKey") {
      return this.withDecryptedTokens(acct)
    }
    if (!acct.token_expires_at) {
      return this.withDecryptedTokens(acct)
    }
    const now = Date.now()
    const expiresAt = new Date(acct.token_expires_at).getTime()
    const fiveMinutes = 5 * 60 * 1000
    if (expiresAt - now > fiveMinutes) {
      return this.withDecryptedTokens(acct)
    }
    const refreshToken = acct.refresh_token ? decryptSecret(acct.refresh_token) : ""
    if (!refreshToken) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Faire access token has expired. Please reconnect your Faire account."
      )
    }
    try {
      // OAuth-only path (apiKey accounts short-circuited above).
      const client = this.getClient("oauth")
      const token = await client.refreshAccessToken(refreshToken)
      const updated = await this.updateFaireSyncAccounts({
        id: acct.id,
        access_token: encryptSecret(token.access_token),
        refresh_token: encryptSecret(token.refresh_token ?? refreshToken),
        token_expires_at:
          token.expires_in != null
            ? new Date(token.retrieved_at + token.expires_in * 1000)
            : null,
      } as any)
      return this.withDecryptedTokens(updated)
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

  async getTaxonomyTypes(): Promise<Array<{ id: string; name: string }>> {
    const account = await this.getActiveAccount()
    if (!account) return []
    // Tokens are stored AES-256-GCM encrypted at rest — go through
    // ensureFreshToken so we send Faire the DECRYPTED (and non-expired) token.
    // Passing the raw ciphertext gets a 401 that the client silently swallows to
    // [], which surfaces as an empty taxonomy picker.
    const fresh = await this.ensureFreshToken(account)
    const client = this.getClient(account.auth_mode as "oauth" | "apiKey")
    return client.getTaxonomyTypes(fresh!.access_token)
  }

  /**
   * High-water mark for incremental order polling. Returns the last successful
   * sync timestamp, or null if orders have never been polled (full backfill).
   */
  async getLastOrderSyncAt(): Promise<Date | null> {
    const settings = await this.getSettings()
    const v = (settings as any).last_order_sync_at
    return v ? new Date(v) : null
  }

  async setLastOrderSyncAt(at: Date): Promise<void> {
    await this.updateSettings({ last_order_sync_at: at })
  }

  async startOAuth(): Promise<{ authorization_url: string; state: string }> {
    // Both connection types are available per-account, so OAuth is always
    // offered here; the API-key path is a separate entry point.
    try {
      const state = crypto.randomUUID()
      await this.updateSettings({
        pending_oauth: {
          state,
          created_at: Date.now(),
        },
      })
      const client = this.getClient("oauth")
      return {
        authorization_url: client.getAuthorizationUrl(state),
        state,
      }
    } catch (err) {
      throw toMedusaError(err)
    }
  }

  /**
   * API-key (single-merchant) connection. Fetches the brand profile using the
   * supplied access token and persists the account. No OAuth round-trip.
   */
  async connectWithApiKey(accessToken: string) {
    if (!accessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A Faire access token is required."
      )
    }
    try {
      // Force API-key auth (X-FAIRE-ACCESS-TOKEN) for this connection regardless
      // of the plugin's default mode, and persist it so later API calls use it.
      const client = this.getClient("apiKey")
      const brand = await client.getBrand(accessToken)
      const token: TokenData = {
        access_token: accessToken,
        token_type: "Bearer",
        retrieved_at: Date.now(),
      }
      const account = await this.saveAccount(token, brand, "apiKey")
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

  async completeOAuth(code: string, state: string) {
    const settings = await this.getSettings()
    const pending: any = settings.pending_oauth
    // eslint-disable-next-line no-console
    console.info(
      `[faire-sync] completeOAuth: received code=${code ? code.slice(0, 6) + "…" : "<none>"} ` +
        `state=${state ? state.slice(0, 8) + "…" : "<none>"} ` +
        `pending=${pending ? "state:" + String(pending.state).slice(0, 8) + "…" : "<none>"} ` +
        `match=${!!pending && pending.state === state}`
    )
    if (!pending || pending.state !== state) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid or expired OAuth state (received "${state}", ` +
          `pending ${pending ? `"${pending.state}"` : "<none>"}). Please start the Faire connection again.`
      )
    }
    let token: TokenData | undefined
    try {
      const client = this.getClient("oauth")
      token = await client.exchangeCodeForToken(code)
      const brand = await client.getBrand(token.access_token)
      const account = await this.saveAccount(token, brand, "oauth")
      await this.updateSettings({
        account_id: account.id,
        default_brand_id: brand.brand_id,
        pending_oauth: null,
      })
      return { account, brand }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[faire-sync] completeOAuth failed during exchange/brand/save:",
        (err as any)?.message || err,
        (err as any)?.body ? `| faire body: ${JSON.stringify((err as any).body)}` : ""
      )
      // Self-heal a dropped OAuth so the next attempt starts clean:
      //  1. clear the pending state (otherwise it sticks and confuses retries), and
      //  2. if the code exchange succeeded but a later step failed, REVOKE the
      //     just-obtained token — otherwise Faire keeps the app "installed via an
      //     active OAuth access token" and every reconnect fails with that 400.
      await this.updateSettings({ pending_oauth: null }).catch(() => {})
      if (token?.access_token) {
        await this.getClient()
          .revokeToken(token.access_token)
          .catch(() => {})
      }
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
