/**
 * VercelHostingProvider — the Vercel hosting operations extracted from
 * DeploymentService, but parameterized by *per-account* credentials instead of
 * reading VERCEL_TOKEN / VERCEL_TEAM_ID from the environment. Behaviour matches
 * the legacy service so existing partners on Vercel are unaffected.
 */

import type {
  AddDomainOptions,
  CreateProjectInput,
  DnsRecordInstruction,
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

type VercelDomainConfig = {
  configuredBy: string | null
  misconfigured: boolean
  recommendedCNAME?: Array<{ rank: number; value: string }>
  recommendedIPv4?: Array<{ rank: number; value: string[] }>
}

const VERCEL_API_BASE = "https://api.vercel.com"
const VERCEL_DEFAULT_CNAME = "cname.vercel-dns.com"

export class VercelHostingProvider implements HostingProvider {
  readonly provider = "vercel" as const
  private readonly token: string
  private readonly teamId?: string

  constructor(creds: HostingCredentials) {
    if (!creds?.token) throw new Error("VercelHostingProvider requires a token")
    this.token = creds.token
    this.teamId = creds.teamId
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }
  }

  private teamQuery(): string {
    return this.teamId ? `?teamId=${this.teamId}` : ""
  }

  dnsTarget(_project: HostingProject): string {
    return VERCEL_DEFAULT_CNAME
  }

  async createProject(input: CreateProjectInput): Promise<HostingProject> {
    const projectName = sanitizeProjectName(input.name)
    const payload: Record<string, any> = {
      name: projectName,
      framework: input.framework || "nextjs",
      gitRepository: { type: "github", repo: input.gitRepo },
    }
    if (input.rootDirectory) payload.rootDirectory = input.rootDirectory
    if (input.installCommand) payload.installCommand = input.installCommand
    if (input.buildCommand) payload.buildCommand = input.buildCommand
    if (input.ignoreCommand) payload.commandForIgnoringBuildStep = input.ignoreCommand

    const res = await fetch(`${VERCEL_API_BASE}/v11/projects${this.teamQuery()}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      throw new Error(`Vercel createProject failed (${res.status}): ${await res.text()}`)
    }
    const project = (await res.json()) as { id: string; name: string }
    return { id: project.id, name: project.name }
  }

  async setEnvVars(projectId: string, envVars: HostingEnvVar[]): Promise<void> {
    const payload = envVars.map((v) => ({
      key: v.key,
      value: v.value,
      type: v.type || "plain",
      target: v.target || ["production", "preview"],
    }))
    const res = await fetch(
      `${VERCEL_API_BASE}/v10/projects/${projectId}/env${this.teamQuery()}&upsert=true`,
      { method: "POST", headers: this.headers(), body: JSON.stringify(payload) }
    )
    if (!res.ok) {
      throw new Error(`Vercel setEnvVars failed (${res.status}): ${await res.text()}`)
    }
  }

  async addDomain(
    projectId: string,
    domain: string,
    opts?: AddDomainOptions
  ): Promise<HostingDomain> {
    const body: Record<string, any> = { name: domain }
    if (opts?.redirect) {
      body.redirect = opts.redirect
      body.redirectStatusCode = opts.redirectStatusCode ?? 308
    }
    const res = await fetch(
      `${VERCEL_API_BASE}/v10/projects/${projectId}/domains${this.teamQuery()}`,
      { method: "POST", headers: this.headers(), body: JSON.stringify(body) }
    )
    if (!res.ok) {
      throw new Error(`Vercel addDomain failed (${res.status}): ${await res.text()}`)
    }
    const d = (await res.json()) as {
      name: string
      verified: boolean
      verification?: Array<{ type: string; domain: string; value: string; reason?: string }>
    }
    return { name: d.name, verified: d.verified, verification: d.verification }
  }

  async removeDomain(projectId: string, domain: string): Promise<void> {
    const res = await fetch(
      `${VERCEL_API_BASE}/v9/projects/${projectId}/domains/${domain}${this.teamQuery()}`,
      { method: "DELETE", headers: this.headers() }
    )
    if (!res.ok && res.status !== 404) {
      throw new Error(`Vercel removeDomain failed (${res.status}): ${await res.text()}`)
    }
  }

  async verifyDomain(projectId: string, domain: string): Promise<HostingDomain> {
    const res = await fetch(
      `${VERCEL_API_BASE}/v9/projects/${projectId}/domains/${domain}/verify${this.teamQuery()}`,
      { method: "POST", headers: this.headers() }
    )
    if (!res.ok) {
      throw new Error(`Vercel verifyDomain failed (${res.status}): ${await res.text()}`)
    }
    const d = (await res.json()) as {
      name: string
      verified: boolean
      verification?: Array<{ type: string; domain: string; value: string; reason?: string }>
    }
    return { name: d.name, verified: d.verified, verification: d.verification }
  }

  private async getDomainConfig(domain: string): Promise<VercelDomainConfig | null> {
    try {
      const res = await fetch(
        `${VERCEL_API_BASE}/v6/domains/${domain}/config${this.teamQuery()}`,
        { method: "GET", headers: this.headers() }
      )
      if (!res.ok) return null
      return (await res.json()) as VercelDomainConfig
    } catch {
      return null
    }
  }

  async describeDomain(_projectId: string, domain: string): Promise<HostingDomainStatus> {
    const config = await this.getDomainConfig(domain)
    const dnsRecords: DnsRecordInstruction[] = []
    if (isApexDomain(domain)) {
      // Apex can't CNAME — Vercel serves apexes via an A record.
      const ipv4 = config?.recommendedIPv4?.[0]?.value?.[0] || "76.76.21.21"
      dnsRecords.push({ type: "A", host: "@", value: ipv4 })
    } else {
      const cname = config?.recommendedCNAME?.[0]?.value || "cname.vercel-dns.com"
      dnsRecords.push(cnameInstruction(domain, cname))
    }
    return {
      name: domain,
      misconfigured: config?.misconfigured ?? true,
      configuredBy: config?.configuredBy ?? null,
      dnsRecords,
    }
  }

  async triggerDeployment(input: TriggerDeploymentInput): Promise<HostingDeployment> {
    const [org, repo] = input.gitRepo.split("/")
    const res = await fetch(
      `${VERCEL_API_BASE}/v13/deployments${this.teamQuery()}&forceNew=1&skipAutoDetectionConfirmation=1`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          name: sanitizeProjectName(input.projectName),
          target: "production",
          gitSource: { type: "github", org, repo, ref: input.ref || "main" },
        }),
      }
    )
    if (!res.ok) {
      throw new Error(`Vercel triggerDeployment failed (${res.status}): ${await res.text()}`)
    }
    const d = (await res.json()) as { id: string; url: string; readyState: string }
    return { id: d.id, url: d.url, status: d.readyState }
  }

  async getProject(projectId: string): Promise<HostingProject> {
    const res = await fetch(
      `${VERCEL_API_BASE}/v9/projects/${projectId}${this.teamQuery()}`,
      { method: "GET", headers: this.headers() }
    )
    if (!res.ok) {
      throw new Error(`Vercel getProject failed (${res.status}): ${await res.text()}`)
    }
    const p = (await res.json()) as { id: string; name: string }
    return { id: p.id, name: p.name }
  }
}
