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

export type AddDomainOptions = {
  /** Attach this host as a permanent redirect to another (Vercel www↔apex pairing). */
  redirect?: string
  redirectStatusCode?: 301 | 302 | 307 | 308
}

/** A DNS record the partner must create on their own registrar for a partner-owned domain. */
export type DnsRecordInstruction = { type: string; host: string; value: string }

/**
 * Everything the partner UI needs to render a custom-domain status card — the
 * shape is uniform, but how each provider fills it differs:
 *   - Vercel: `dnsRecords` come from the live per-domain recommendation
 *     (A → recommendedIPv4 for apex, CNAME → recommendedCNAME for subdomains);
 *     `misconfigured`/`configuredBy` from getDomainConfig.
 *   - Cloudflare Pages: a single CNAME → `<project>.pages.dev`; `verified`
 *     reflects the Pages domain `status`.
 */
export type HostingDomainStatus = {
  name: string
  verified?: boolean
  misconfigured: boolean
  configuredBy?: string | null
  verification?: HostingDomainVerification[]
  dnsRecords: DnsRecordInstruction[]
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
  triggerDeployment(input: TriggerDeploymentInput): Promise<HostingDeployment>
  getProject(projectId: string): Promise<HostingProject>

  // ── Custom domain lifecycle (provider-specific DNS/verification) ──────────
  addDomain(projectId: string, domain: string, opts?: AddDomainOptions): Promise<HostingDomain>
  removeDomain(projectId: string, domain: string): Promise<void>
  /** Re-check ownership/attachment. */
  verifyDomain(projectId: string, domain: string): Promise<HostingDomain>
  /** Live status + the DNS records the partner must publish for this domain. */
  describeDomain(projectId: string, domain: string): Promise<HostingDomainStatus>

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

/** "example.com" → true; "shop.example.com" / "www.example.com" → false. */
export function isApexDomain(domain: string): boolean {
  return domain.split(".").length === 2
}

/** The record host label a partner enters at their registrar ("@" for apex, else the subdomain part). */
export function dnsHostLabel(domain: string): string {
  if (isApexDomain(domain)) return "@"
  const parts = domain.split(".")
  return parts.slice(0, parts.length - 2).join(".")
}

/**
 * Build the CNAME instruction a partner must add for a subdomain pointing at a
 * provider origin. Apex domains can't CNAME — callers handle those separately
 * (Vercel A record; Cloudflare Pages requires the domain in a CF zone).
 */
export function cnameInstruction(
  domain: string,
  target: string
): DnsRecordInstruction {
  return { type: "CNAME", host: dnsHostLabel(domain), value: target }
}
