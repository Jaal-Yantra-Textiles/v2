/**
 * NetlifyProvider — Netlify as a storefront hosting target (#884 S5).
 *
 * Netlify REST API v1 (https://api.netlify.com/api/v1), Bearer PAT. A site is
 * linked to a GitHub repo at create time; Netlify auto-detects Next.js and
 * applies @netlify/plugin-nextjs so SSR "just works" (no separate service type).
 *
 * Projects are addressed by the opaque `site_id`, so `HostingProject.id` is the
 * site id here (like Vercel), while `name`/`originHost` carry the
 * `<name>.netlify.app` subdomain used as the CNAME target.
 *
 * Credentials (decrypted from `deployment_account.api_config`):
 *   - token       Netlify personal access token
 *   - accountId   Netlify team/account id (for the env-vars API + team-scoped create)
 *   - extra.github_installation_id   the Netlify GitHub App installation id (required to link a repo)
 *   - extra.github_repo_id           numeric GitHub repo id (optional; Netlify resolves it when omitted)
 */

import type {
  AddDomainOptions,
  CreateProjectInput,
  HostingCredentials,
  HostingDeployment,
  HostingDomain,
  HostingDomainStatus,
  HostingEnvVar,
  HostingProject,
  HostingProvider,
  TriggerDeploymentInput,
} from "./types"
import { cnameInstruction, isApexDomain, sanitizeProjectName } from "./types"

const NETLIFY_API = "https://api.netlify.com/api/v1"

type NetlifySite = {
  id: string
  name: string
  url?: string
  ssl_url?: string
  admin_url?: string
  custom_domain?: string | null
  default_domain?: string
}

export class NetlifyProvider implements HostingProvider {
  readonly provider = "netlify" as const
  private readonly token: string
  private readonly accountId?: string
  private readonly installationId?: string
  private readonly repoId?: string

  constructor(creds: HostingCredentials) {
    if (!creds?.token) throw new Error("NetlifyProvider requires a token")
    this.token = creds.token
    this.accountId = creds.accountId
    this.installationId = creds.extra?.github_installation_id
    this.repoId = creds.extra?.github_repo_id
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }
  }

  private async nf<T>(url: string, init: RequestInit, op: string): Promise<T> {
    const res = await fetch(url, { ...init, headers: this.headers() })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Netlify ${op} failed (${res.status}): ${body || res.statusText}`)
    }
    return (await res.json().catch(() => ({}))) as T
  }

  /** The `<name>.netlify.app` origin a subdomain should CNAME to. */
  dnsTarget(project: HostingProject): string {
    if (project.originHost) return project.originHost
    return `${sanitizeProjectName(project.name)}.netlify.app`
  }

  private originFromSite(site: NetlifySite): string {
    // Prefer the exact host Netlify returns; fall back to the convention.
    const raw = site.ssl_url || site.url || (site.default_domain ? `https://${site.default_domain}` : "")
    if (raw) {
      try {
        return new URL(raw).hostname
      } catch {
        // fall through
      }
    }
    return `${site.name}.netlify.app`
  }

  async createProject(input: CreateProjectInput): Promise<HostingProject> {
    if (!this.installationId) {
      throw new Error(
        "NetlifyProvider.createProject requires api_config.github_installation_id " +
          "(install the Netlify GitHub App on the account once, then store its installation id)"
      )
    }
    const name = sanitizeProjectName(input.name)
    const branch = input.productionBranch || "main"

    const repo: Record<string, any> = {
      provider: "github",
      repo: input.gitRepo,
      private: false,
      branch,
      cmd: input.buildCommand || "npm run build",
      installation_id: this.installationId,
    }
    if (this.repoId) repo.repo_id = Number(this.repoId)
    if (input.rootDirectory) repo.base = input.rootDirectory

    // Team-scoped create when we know the account slug/id, else the default team.
    const createUrl = this.accountId
      ? `${NETLIFY_API}/${this.accountId}/sites`
      : `${NETLIFY_API}/sites`

    const site = await this.nf<NetlifySite>(
      createUrl,
      { method: "POST", body: JSON.stringify({ name, repo }) },
      "createProject"
    )
    return { id: site.id, name: site.name, originHost: this.originFromSite(site) }
  }

  async setEnvVars(siteId: string, envVars: HostingEnvVar[]): Promise<void> {
    if (!this.accountId) {
      throw new Error(
        "NetlifyProvider.setEnvVars requires api_config.account_id (Netlify team/account id) for the env-vars API"
      )
    }
    const payload = envVars.map((v) => ({
      key: v.key,
      scopes: ["builds", "functions", "runtime"],
      values: [{ value: v.value, context: "all" }],
    }))
    await this.nf(
      `${NETLIFY_API}/accounts/${this.accountId}/env?site_id=${encodeURIComponent(siteId)}`,
      { method: "POST", body: JSON.stringify(payload) },
      "setEnvVars"
    )
  }

  async addDomain(
    siteId: string,
    domain: string,
    _opts?: AddDomainOptions
  ): Promise<HostingDomain> {
    // Netlify sets the primary custom domain on the site record; it verifies
    // automatically once the CNAME resolves (no TXT records to publish).
    try {
      const site = await this.nf<NetlifySite>(
        `${NETLIFY_API}/sites/${siteId}`,
        { method: "PATCH", body: JSON.stringify({ custom_domain: domain }) },
        "addDomain"
      )
      return { name: site.custom_domain || domain, verified: false, verification: [] }
    } catch (e: any) {
      return { name: domain, verified: false, verification: [], error: e.message }
    }
  }

  async removeDomain(siteId: string, _domain: string): Promise<void> {
    // Clear the primary custom domain.
    const res = await fetch(`${NETLIFY_API}/sites/${siteId}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ custom_domain: null }),
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`Netlify removeDomain failed (${res.status}): ${await res.text()}`)
    }
  }

  async verifyDomain(siteId: string, domain: string): Promise<HostingDomain> {
    const site = await this.nf<NetlifySite>(
      `${NETLIFY_API}/sites/${siteId}`,
      { method: "GET" },
      "verifyDomain"
    )
    // Verified once the custom domain is set AND TLS is provisioned (ssl_url present for it).
    const verified = site.custom_domain === domain && !!site.ssl_url
    return { name: domain, verified, verification: [] }
  }

  async describeDomain(siteId: string, domain: string): Promise<HostingDomainStatus> {
    let site: NetlifySite | null = null
    try {
      site = await this.nf<NetlifySite>(`${NETLIFY_API}/sites/${siteId}`, { method: "GET" }, "describeDomain")
    } catch {
      // fall through with defaults
    }
    const target = site ? this.originFromSite(site) : `${sanitizeProjectName(domain)}.netlify.app`
    const active = !!site && site.custom_domain === domain && !!site.ssl_url
    const dnsRecords = isApexDomain(domain)
      ? [{ type: "ALIAS", host: "@", value: target }] // apex → Netlify ALIAS/ANAME
      : [cnameInstruction(domain, target)]
    return {
      name: domain,
      verified: active,
      misconfigured: !active,
      configuredBy: active ? "CNAME" : null,
      dnsRecords,
    }
  }

  async triggerDeployment(input: TriggerDeploymentInput): Promise<HostingDeployment> {
    const siteId = input.projectId || input.projectName
    const build = await this.nf<{ id: string; deploy_id?: string; deploy_ssl_url?: string }>(
      `${NETLIFY_API}/sites/${siteId}/builds`,
      { method: "POST", body: JSON.stringify({ clear_cache: false }) },
      "triggerDeployment"
    )
    return {
      id: build.deploy_id || build.id,
      url: build.deploy_ssl_url || "",
      status: "building",
    }
  }

  async getProject(siteId: string): Promise<HostingProject> {
    const site = await this.nf<NetlifySite>(`${NETLIFY_API}/sites/${siteId}`, { method: "GET" }, "getProject")
    return { id: site.id, name: site.name, originHost: this.originFromSite(site) }
  }
}
