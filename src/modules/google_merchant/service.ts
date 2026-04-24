import { MedusaService, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import GoogleMerchantAccount from "./models/google_merchant_account"
import GoogleMerchantSyncJob from "./models/google_merchant_sync_job"
import { GoogleMerchantProvider } from "./provider"
import { ENCRYPTION_MODULE } from "../encryption"
import type EncryptionService from "../encryption/service"

const TOKEN_REFRESH_BUFFER_MS = 60_000

export type AuthedProvider = {
  account: any
  provider: GoogleMerchantProvider
  accessToken: string
}

class GoogleMerchantService extends MedusaService({
  GoogleMerchantAccount,
  GoogleMerchantSyncJob,
}) {
  constructor() {
    super(...arguments)
  }

  /**
   * Loads the account, decrypts secrets via the encryption module, builds a
   * per-account provider, and returns a fresh access token — refreshing and
   * persisting the new token when the stored one is missing or near expiry.
   *
   * Callers should never touch access_token / refresh_token directly.
   *
   * `container` must be the app-level container (req.scope from an API route
   * or the step's `container`). The module's own __container__ cannot resolve
   * other modules under module isolation.
   */
  async getAuthedProvider(accountId: string, container: MedusaContainer): Promise<AuthedProvider> {
    const encryption = this.#encryption(container)

    const [account] = await this.listGoogleMerchantAccounts({ id: accountId }, { take: 1 })
    if (!account) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Google Merchant account ${accountId} not found`)
    }
    if (!account.refresh_token) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Account ${accountId} is not authenticated — complete OAuth first`
      )
    }
    if (!account.merchant_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Account ${accountId} is missing merchant_id`
      )
    }

    const clientSecret = encryption.decrypt(account.client_secret as any)
    const refreshToken = encryption.decrypt(account.refresh_token as any)

    const provider = new GoogleMerchantProvider({
      client_id: account.client_id,
      client_secret: clientSecret,
      redirect_uri: account.redirect_uri,
      merchant_id: account.merchant_id,
    })

    const accessToken = await this.#ensureValidAccessToken(account, provider, refreshToken, encryption)

    return { account, provider, accessToken }
  }

  /**
   * Force a token refresh regardless of expiry — useful after an API call returns 401.
   */
  async refreshAndStoreAccessToken(accountId: string, container: MedusaContainer): Promise<string> {
    const encryption = this.#encryption(container)
    const [account] = await this.listGoogleMerchantAccounts({ id: accountId }, { take: 1 })
    if (!account?.refresh_token) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Account not authenticated")
    }
    const refreshToken = encryption.decrypt(account.refresh_token as any)
    const provider = new GoogleMerchantProvider({
      client_id: account.client_id,
      client_secret: encryption.decrypt(account.client_secret as any),
      redirect_uri: account.redirect_uri,
      merchant_id: account.merchant_id,
    })
    const refreshed = await provider.refreshAccessToken(refreshToken)
    const now = new Date()
    await this.updateGoogleMerchantAccounts({
      id: account.id,
      access_token: JSON.stringify(encryption.encrypt(refreshed.access_token)),
      token_expires_at: refreshed.expires_in ? new Date(now.getTime() + refreshed.expires_in * 1000) : null,
      token_refreshed_at: now,
    })
    return refreshed.access_token
  }

  #encryption(container: MedusaContainer): EncryptionService {
    return container.resolve(ENCRYPTION_MODULE) as EncryptionService
  }

  async #ensureValidAccessToken(
    account: any,
    provider: GoogleMerchantProvider,
    refreshToken: string,
    encryption: EncryptionService
  ): Promise<string> {
    const stored = this.#decryptAccessToken(account.access_token, encryption)
    const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0

    if (stored && Date.now() < expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return stored
    }

    const refreshed = await provider.refreshAccessToken(refreshToken)
    const now = new Date()
    await this.updateGoogleMerchantAccounts({
      id: account.id,
      access_token: JSON.stringify(encryption.encrypt(refreshed.access_token)),
      token_expires_at: refreshed.expires_in ? new Date(now.getTime() + refreshed.expires_in * 1000) : null,
      token_refreshed_at: now,
    })
    return refreshed.access_token
  }

  #decryptAccessToken(stored: string | null | undefined, encryption: EncryptionService): string | undefined {
    if (!stored) return undefined
    // Legacy rows may hold the plaintext token. New rows are JSON-serialized EncryptedData blobs.
    if (!stored.startsWith("{")) return stored
    try {
      const parsed = JSON.parse(stored)
      if (parsed && typeof parsed === "object" && "encrypted" in parsed) {
        return encryption.decrypt(parsed)
      }
      return stored
    } catch {
      return stored
    }
  }
}

export default GoogleMerchantService
