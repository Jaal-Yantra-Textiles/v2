import type { MedusaContainer } from "@medusajs/framework"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type EncryptionService from "../../../modules/encryption/service"
import { remainingCapacity, type DeploymentAccountRow } from "../../../modules/deployment/account-selector"
import { API_CONFIG_KEYS } from "./validators"

/**
 * Build the stored `api_config` for a deployment_account:
 *   - token → token_encrypted (AES-256-GCM via the encryption module)
 *   - every non-secret provider field stored plainly
 * On update, `existing` is merged so unspecified fields (and the token when
 * omitted) survive.
 */
export function buildApiConfig(
  input: Record<string, any>,
  container: MedusaContainer,
  existing?: Record<string, any> | null
): Record<string, any> {
  const cfg: Record<string, any> = { ...(existing || {}) }

  // Non-secret provider fields (undefined = leave as-is; null/"" would blank).
  for (const key of API_CONFIG_KEYS) {
    if (input[key] !== undefined) cfg[key] = input[key]
  }

  // Token: only (re)encrypt when a non-empty value is supplied.
  if (typeof input.token === "string" && input.token.length > 0) {
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    cfg.token_encrypted = encryption.encrypt(input.token)
    // Never keep a plaintext token in the stored config.
    delete cfg.token
  }

  return cfg
}

/**
 * Redact a deployment_account row for API responses: strip the encrypted token
 * blob, expose a `token_present` boolean instead, and surface live capacity.
 */
export function redactDeploymentAccount(account: any): any {
  const api_config = (account?.api_config || {}) as Record<string, any>
  const { token_encrypted, token, ...safeConfig } = api_config

  const row: DeploymentAccountRow = {
    id: account.id,
    provider: account.provider,
    label: account.label,
    cutoff_max: account.cutoff_max,
    project_count: account.project_count,
    priority: account.priority,
    status: account.status,
  }
  const cap = remainingCapacity(row)

  return {
    ...account,
    api_config: {
      ...safeConfig,
      token_present: !!(token_encrypted || token),
    },
    remaining_capacity: Number.isFinite(cap) ? cap : null, // null = uncapped
  }
}
