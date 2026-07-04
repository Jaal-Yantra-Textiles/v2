/**
 * HostingProvider — the storefront hosting abstraction (S2 of #884).
 *
 * Modelled on the social-provider pattern: each provider is a small class
 * constructed with its *own* decrypted credentials (resolved from a
 * `deployment_account` row via the encryption module) and exposes a common
 * interface. The provision workflow selects an account (S1 selector), resolves
 * its provider through the registry, and runs the hosting steps against it —
 * instead of every partner going to one env-configured Vercel team.
 *
 * DNS stays Cloudflare (handled by DeploymentService); this interface only
 * covers the *hosting* side: project ← GitHub repo, env vars, custom domain,
 * deployment.
 */

export type HostingProviderName = "vercel" | "cloudflare" | "render" | "netlify"

/** Per-account credentials, decrypted at runtime from `deployment_account.api_config`. */
export type HostingCredentials = {
  /** API token (Vercel token / Cloudflare API token). */
  token: string
  /** Vercel team id (optional — personal accounts omit it). */
  teamId?: string
  /** Cloudflare/Render account id (the URL-scoping id). */
  accountId?: string
}

export type CreateProjectInput = {
  name: string
  /** "org/repo" on GitHub. */
  gitRepo: string
  framework?: string
  rootDirectory?: string
  productionBranch?: string
  installCommand?: string
  buildCommand?: string
  ignoreCommand?: string
}

export type HostingProject = {
  /** Provider identifier used in subsequent API calls (Vercel: project id; Cloudflare Pages: project name). */
  id: string
  name: string
  /** The `<subdomain>` origin the storefront resolves to on the provider's platform, e.g. `foo.pages.dev` (Cloudflare). */
  originHost?: string
}

export type HostingEnvVar = {
  key: string
  value: string
  type?: "plain" | "sensitive"
  target?: string[]
}

export type HostingDomainVerification = {
  type: string
  domain: string
  value: string
  reason?: string
}

export type HostingDomain = {
  name: string
  verified: boolean
  /** DNS records the operator must add for the provider to verify the domain. */
  verification?: HostingDomainVerification[]
  error?: string
}

export type TriggerDeploymentInput = {
  projectName: string
  gitRepo: string
  ref?: string
}

export type HostingDeployment = {
  id: string
  url: string
  status: string
}

export interface HostingProvider {
  readonly provider: HostingProviderName

  createProject(input: CreateProjectInput): Promise<HostingProject>
  setEnvVars(projectId: string, envVars: HostingEnvVar[]): Promise<void>
  addDomain(projectId: string, domain: string): Promise<HostingDomain>
  triggerDeployment(input: TriggerDeploymentInput): Promise<HostingDeployment>
  getProject(projectId: string): Promise<HostingProject>

  /**
   * The CNAME target a storefront subdomain should point at in Cloudflare DNS
   * for a project on this provider. Vercel → `cname.vercel-dns.com`;
   * Cloudflare Pages → `<project>.pages.dev`. (The initial provision may refine
   * Vercel's value via getDomainConfig's per-project recommendation.)
   */
  dnsTarget(project: HostingProject): string
}

// ─── Shared pure helpers ─────────────────────────────────────────────────────

/**
 * Normalize a desired project name into a provider-safe slug. Both Vercel and
 * Cloudflare Pages accept lowercase alphanumerics + dashes; Pages is stricter
 * (no dots, ≤58 chars) so we take the intersection to keep names portable
 * across providers.
 */
export function sanitizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58)
}
