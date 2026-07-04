/**
 * Hosting provider registry — resolves a `deployment_account` row into a
 * ready-to-use HostingProvider with its own decrypted credentials.
 *
 * The workflow (S3) will: select an account (account-selector) → resolve its
 * decrypted creds (resolveAccountCredentials) → build the provider
 * (createHostingProvider) → run the hosting steps against it.
 */

import type { EncryptedData } from "../../encryption/service"
import { CloudflarePagesProvider } from "./cloudflare-pages-provider"
import type { HostingCredentials, HostingProvider, HostingProviderName } from "./types"
import { VercelHostingProvider } from "./vercel-provider"

export { sanitizeProjectName } from "./types"
export type {
  CreateProjectInput,
  HostingCredentials,
  HostingDeployment,
  HostingDomain,
  HostingEnvVar,
  HostingProject,
  HostingProvider,
  HostingProviderName,
  TriggerDeploymentInput,
} from "./types"

/**
 * Shape of `deployment_account.api_config`. Tokens are stored encrypted
 * (EncryptedData) — same convention as SocialPlatform. A plaintext `token`
 * fallback is tolerated for local/dev seeds.
 */
export type DeploymentApiConfig = {
  token_encrypted?: EncryptedData
  token?: string
  team_id?: string
  account_id?: string
  zone_id?: string
} | null | undefined

/** Minimal decryptor surface — the encryption module's service satisfies this. */
export type Decryptor = { decrypt(data: EncryptedData): string }

/**
 * Turn an account's stored api_config into runtime credentials, decrypting the
 * token when it's stored as an EncryptedData object.
 */
export function resolveAccountCredentials(
  apiConfig: DeploymentApiConfig,
  decryptor?: Decryptor
): HostingCredentials {
  const cfg = apiConfig ?? {}

  let token: string | undefined = cfg.token
  if (cfg.token_encrypted) {
    if (!decryptor) {
      throw new Error("resolveAccountCredentials: token is encrypted but no decryptor was provided")
    }
    token = decryptor.decrypt(cfg.token_encrypted)
  }

  if (!token) {
    throw new Error("resolveAccountCredentials: deployment account has no token")
  }

  return {
    token,
    teamId: cfg.team_id || undefined,
    accountId: cfg.account_id || undefined,
  }
}

/** Build a HostingProvider for a provider name + credentials. */
export function createHostingProvider(
  provider: HostingProviderName,
  creds: HostingCredentials
): HostingProvider {
  switch (provider) {
    case "vercel":
      return new VercelHostingProvider(creds)
    case "cloudflare":
      return new CloudflarePagesProvider(creds)
    case "render":
    case "netlify":
      throw new Error(`Hosting provider "${provider}" not implemented yet (S5)`)
    default:
      throw new Error(`Unknown hosting provider: ${provider}`)
  }
}

/**
 * Convenience: resolve creds + build the provider in one call from a
 * `deployment_account` row.
 */
export function hostingProviderForAccount(
  account: { provider: HostingProviderName; api_config: DeploymentApiConfig },
  decryptor?: Decryptor
): HostingProvider {
  const creds = resolveAccountCredentials(account.api_config, decryptor)
  return createHostingProvider(account.provider, creds)
}

export { VercelHostingProvider } from "./vercel-provider"
export { CloudflarePagesProvider } from "./cloudflare-pages-provider"
