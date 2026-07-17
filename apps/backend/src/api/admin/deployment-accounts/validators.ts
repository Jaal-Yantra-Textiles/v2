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
  // Shared multi-tenant target: when set, this account provisions in "shared"
  // mode — a new partner attaches its domain to this ONE pre-deployed project
  // instead of getting its own deploy (see resolveProvisioningMode).
  //   - Vercel/Render: shared_project_id (+ optional shared_project_name)
  //   - Cloudflare Workers: shared_worker_name (the worker addresses by name)
  shared_project_id: z.string().optional(),
  shared_project_name: z.string().optional(),
  shared_worker_name: z.string().optional(),
  // Cloudflare for SaaS: the proxied in-zone hostname partner-OWNED domains
  // CNAME to (routes to the shared worker). Enables Custom Hostnames for domains
  // outside our zone. `zone_name` lets the provider skip a zone lookup.
  saas_fallback_origin: z.string().optional(),
  zone_name: z.string().optional(),
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
  "shared_project_id",
  "shared_project_name",
  "shared_worker_name",
  "saas_fallback_origin",
  "zone_name",
] as const
