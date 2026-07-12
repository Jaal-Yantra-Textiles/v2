import { z } from "@medusajs/framework/zod"

/**
 * Deployment-account admin validators (#884 S4).
 *
 * A deployment_account is a rotatable hosting-provider account. The `token` is
 * the only secret — it is encrypted at rest into `api_config.token_encrypted`;
 * every other field is non-secret provider config stored plainly in api_config
 * (or as a typed column: provider/label/cutoff_max/priority/status).
 */

export const DeploymentProviderSchema = z.enum([
  "vercel",
  "cloudflare",
  "render",
  "netlify",
])

export const DeploymentAccountStatusSchema = z.enum(["active", "full", "inactive"])

// Non-secret provider config fields (mirrors HostingCredentials.extra + ids).
const providerConfigFields = {
  team_id: z.string().optional(),
  account_id: z.string().optional(),
  zone_id: z.string().optional(),
  github_installation_id: z.string().optional(),
  github_repo_id: z.string().optional(),
  owner_id: z.string().optional(),
  region: z.string().optional(),
  plan: z.string().optional(),
}

export const CreateDeploymentAccountSchema = z
  .object({
    provider: DeploymentProviderSchema,
    label: z.string().min(1),
    role: z.string().optional(),
    /** The API token/PAT/key — required on create; encrypted at rest. */
    token: z.string().min(1),
    cutoff_max: z.number().int().positive().nullable().optional(),
    priority: z.number().int().optional(),
    status: DeploymentAccountStatusSchema.optional(),
    ...providerConfigFields,
  })
  .strict()

export const UpdateDeploymentAccountSchema = z
  .object({
    label: z.string().min(1).optional(),
    role: z.string().optional(),
    /** Provide only to rotate the token; omit/blank keeps the stored one. */
    token: z.string().optional(),
    cutoff_max: z.number().int().positive().nullable().optional(),
    priority: z.number().int().optional(),
    status: DeploymentAccountStatusSchema.optional(),
    ...providerConfigFields,
  })
  .strict()

export const ListDeploymentAccountsQuerySchema = z
  .object({
    q: z.string().optional(),
    provider: DeploymentProviderSchema.optional(),
    status: DeploymentAccountStatusSchema.optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    order: z.string().optional(),
  })
  .strict()

export type CreateDeploymentAccountBody = z.infer<typeof CreateDeploymentAccountSchema>
export type UpdateDeploymentAccountBody = z.infer<typeof UpdateDeploymentAccountSchema>

/** The non-secret config keys that live in api_config alongside token_encrypted. */
export const API_CONFIG_KEYS = [
  "team_id",
  "account_id",
  "zone_id",
  "github_installation_id",
  "github_repo_id",
  "owner_id",
  "region",
  "plan",
] as const
