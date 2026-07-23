/**
 * RenderProvider — Render as a storefront hosting target (#884 S5).
 *
 * Render REST API v1 (https://api.render.com/v1), Bearer API key. A Next.js
 * storefront runs as a `web_service` (a long-running Node process serving
 * `next start`) linked to a GitHub repo. Projects are addressed by the opaque
 * `service id`, so `HostingProject.id` is the service id; `originHost` carries
 * the `<slug>.onrender.com` host used as the CNAME target.
 *
 * Credentials (decrypted from `deployment_account.api_config`):
 *   - token          Render API key
 *   - extra.owner_id Render workspace/owner id (from GET /v1/owners) — required to create
 *   - extra.region   optional Render region (default "oregon")
 *   - extra.plan     optional Render plan (default "starter")
 *
 * Prerequisite: the Render GitHub App must be installed on the account so the
 * repo is connectable (done once via the dashboard).
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

const RENDER_API = "https://api.render.com/v1"

type RenderService = {
  id: string
  name: string
  slug?: string
  serviceDetails?: { url?: string }
}

type RenderCustomDomain = { id: string; name: string; verificationStatus?: string }

export class RenderProvider implements HostingProvider {
  readonly provider = "render" as const
  private readonly token: string
  private readonly ownerId?: string
  private readonly region: string
  private readonly plan: string

  constructor(creds: HostingCredentials) {
    if (!creds?.token) throw new Error("RenderProvider requires a token")
    this.token = creds.token
    this.ownerId = creds.extra?.owner_id
    this.region = creds.extra?.region || "oregon"
    this.plan = creds.extra?.plan || "starter"
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    }
  }

  private async rd<T>(url: string, init: RequestInit, op: string): Promise<T> {
    const res = await fetch(url, { ...init, headers: this.headers() })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Render ${op} failed (${res.status}): ${body || res.statusText}`)
    }
    return (await res.json().catch(() => ({}))) as T
  }

  /** `<slug>.onrender.com` — the origin a subdomain should CNAME to. */
  dnsTarget(project: HostingProject): string {
    if (project.originHost) return project.originHost
    return `${sanitizeProjectName(project.name)}.onrender.com`
  }

  private originFromService(svc: RenderService): string {
    const url = svc.serviceDetails?.url
    if (url) {
      try {
        return new URL(url).hostname
      } catch {
        // fall through
      }
    }
    return `${svc.slug || sanitizeProjectName(svc.name)}.onrender.com`
  }

  async createProject(input: CreateProjectInput): Promise<HostingProject> {
    if (!this.ownerId) {
      throw new Error(
        "RenderProvider.createProject requires api_config.owner_id (Render workspace/owner id from GET /v1/owners)"
      )
    }
    const name = sanitizeProjectName(input.name)
    const gitUrl = input.gitRepo.startsWith("http")
      ? input.gitRepo
      : `https://github.com/${input.gitRepo}`

    const payload: Record<string, any> = {
      type: "web_service",
      name,
      ownerId: this.ownerId,
      repo: gitUrl,
      branch: input.productionBranch || "main",
      autoDeploy: "yes",
      rootDir: input.rootDirectory || "",
      serviceDetails: {
        env: "node",
        region: this.region,
        plan: this.plan,
        envSpecificDetails: {
          buildCommand: input.buildCommand || "npm install && npm run build",
          startCommand: "npm run start",
        },
      },
    }

    // Render wraps the created service under `.service` in the create response.
    const created = await this.rd<{ service: RenderService } | RenderService>(
      `${RENDER_API}/services`,
      { method: "POST", body: JSON.stringify(payload) },
      "createProject"
    )
    const svc = (created as any).service ?? (created as RenderService)
    return { id: svc.id, name: svc.name, originHost: this.originFromService(svc) }
  }

  async setEnvVars(serviceId: string, envVars: HostingEnvVar[]): Promise<void> {
    // PUT is a full replace of the service's env vars.
    const payload = envVars.map((v) => ({ key: v.key, value: v.value }))
    await this.rd(
      `${RENDER_API}/services/${serviceId}/env-vars`,
      { method: "PUT", body: JSON.stringify(payload) },
      "setEnvVars"
    )
  }

  async addDomain(
    serviceId: string,
    domain: string,
    _opts?: AddDomainOptions
  ): Promise<HostingDomain> {
    try {
      const d = await this.rd<RenderCustomDomain>(
        `${RENDER_API}/services/${serviceId}/custom-domains`,
        { method: "POST", body: JSON.stringify({ name: domain }) },
        "addDomain"
      )
      return {
        name: d.name || domain,
        verified: d.verificationStatus === "verified",
        verification: [],
      }
    } catch (e: any) {
      return { name: domain, verified: false, verification: [], error: e.message }
    }
  }

  async removeDomain(serviceId: string, domain: string): Promise<void> {
    // Render deletes custom domains by their id — look it up by name first.
    const domains = await this.rd<Array<{ customDomain: RenderCustomDomain }> | RenderCustomDomain[]>(
      `${RENDER_API}/services/${serviceId}/custom-domains`,
      { method: "GET" },
      "listCustomDomains"
    ).catch(() => [] as any)
    const match = (domains as any[])
      .map((x) => x.customDomain ?? x)
      .find((d: RenderCustomDomain) => d.name === domain)
    if (!match) return
    const res = await fetch(`${RENDER_API}/services/${serviceId}/custom-domains/${match.id}`, {
      method: "DELETE",
      headers: this.headers(),
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`Render removeDomain failed (${res.status}): ${await res.text()}`)
    }
  }

  private async findCustomDomain(
    serviceId: string,
    domain: string
  ): Promise<RenderCustomDomain | null> {
    try {
      const domains = await this.rd<Array<{ customDomain: RenderCustomDomain }> | RenderCustomDomain[]>(
        `${RENDER_API}/services/${serviceId}/custom-domains`,
        { method: "GET" },
        "listCustomDomains"
      )
      return (
        (domains as any[]).map((x) => x.customDomain ?? x).find((d) => d.name === domain) ?? null
      )
    } catch {
      return null
    }
  }

  async verifyDomain(serviceId: string, domain: string): Promise<HostingDomain> {
    // POST verify triggers Render's DNS check; fall back to reading status.
    try {
      const d = await this.rd<RenderCustomDomain>(
        `${RENDER_API}/services/${serviceId}/custom-domains/${encodeURIComponent(domain)}/verify`,
        { method: "POST", body: JSON.stringify({}) },
        "verifyDomain"
      )
      return { name: domain, verified: d.verificationStatus === "verified", verification: [] }
    } catch {
      const found = await this.findCustomDomain(serviceId, domain)
      return { name: domain, verified: found?.verificationStatus === "verified", verification: [] }
    }
  }

  async describeDomain(serviceId: string, domain: string): Promise<HostingDomainStatus> {
    const found = await this.findCustomDomain(serviceId, domain)
    let target = `${sanitizeProjectName(domain)}.onrender.com`
    try {
      const svc = await this.rd<RenderService>(`${RENDER_API}/services/${serviceId}`, { method: "GET" }, "getService")
      target = this.originFromService(svc)
    } catch {
      // keep fallback target
    }
    const verified = found?.verificationStatus === "verified"
    const dnsRecords = isApexDomain(domain)
      ? [{ type: "A", host: "@", value: "216.24.57.1" }] // Render apex A record
      : [cnameInstruction(domain, target)]
    return {
      name: domain,
      verified,
      misconfigured: !verified,
      configuredBy: verified ? "CNAME" : null,
      dnsRecords,
    }
  }

  async triggerDeployment(input: TriggerDeploymentInput): Promise<HostingDeployment> {
    const serviceId = input.projectId || input.projectName
    const d = await this.rd<{ id: string; status?: string }>(
      `${RENDER_API}/services/${serviceId}/deploys`,
      { method: "POST", body: JSON.stringify({ clearCache: "do_not_clear" }) },
      "triggerDeployment"
    )
    return { id: d.id, url: "", status: d.status || "created" }
  }

  async getProject(serviceId: string): Promise<HostingProject> {
    const svc = await this.rd<RenderService>(`${RENDER_API}/services/${serviceId}`, { method: "GET" }, "getProject")
    return { id: svc.id, name: svc.name, originHost: this.originFromService(svc) }
  }

  /** Delete the Render service (teardown). A 404 means it's already gone. */
  async deleteProject(serviceId: string): Promise<void> {
    const res = await fetch(`${RENDER_API}/services/${serviceId}`, {
      method: "DELETE",
      headers: this.headers(),
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`Render deleteProject failed (${res.status}): ${await res.text().catch(() => res.statusText)}`)
    }
  }
}
