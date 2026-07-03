import { model } from "@medusajs/framework/utils"

/**
 * A hosting/DNS provider account the platform can provision partner storefronts
 * onto — modelled on the "external platform with encrypted creds by role"
 * pattern (like SocialPlatform), but dedicated to deployment so hosting concerns
 * stay out of the socials module.
 *
 * Multiple accounts per provider are supported so provisioning can ROTATE across
 * them: each account has a `cutoff_max` (what a free tier allows) and a live
 * `project_count`. The selector picks the least-loaded active account under its
 * cap; when an account fills, flip `status` to "full" (the "cutoff") and new
 * partners flow to the next. When you upgrade an account to paid, raise
 * `cutoff_max` ("round up"). (partner storefront provisioning)
 */
const DeploymentAccount = model.define("deployment_account", {
  id: model.id({ prefix: "dep_acct" }).primaryKey(),
  provider: model.enum(["vercel", "cloudflare", "render", "netlify"]),
  // Reserved for future non-hosting roles (e.g. dns). Hosting for now.
  role: model.text().default("hosting"),
  // Human label, e.g. "vercel-free-1", "cf-pages-main".
  label: model.text().searchable(),
  // Encrypted credentials + provider ids:
  //   { token_encrypted, team_id, account_id, zone_id, ... }
  // token stored as an EncryptedData object via the encryption module.
  api_config: model.json().nullable(),
  // Max projects this account may hold (free-tier ceiling). null = unlimited.
  cutoff_max: model.number().nullable(),
  // Live count of storefronts provisioned onto this account.
  project_count: model.number().default(0),
  // Tiebreaker when several accounts are equally loaded (higher = preferred).
  priority: model.number().default(0),
  // active = eligible; full = hit cutoff (manual or auto); inactive = disabled.
  status: model.enum(["active", "full", "inactive"]).default("active"),
  metadata: model.json().nullable(),
})

export default DeploymentAccount
