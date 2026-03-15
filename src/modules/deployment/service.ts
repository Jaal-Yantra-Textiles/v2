/**
 * DeploymentService — Manages Vercel projects and Cloudflare DNS for partner storefronts.
 *
 * Resolved from the DI container as "deployment".
 * Usage: container.resolve("deployment") as DeploymentService
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type VercelProject = {
  id: string
  name: string
  link?: { type: string; repo: string }
  latestDeployments?: Array<{
    id: string
    url: string
    readyState: string
    createdAt: number
  }>
}

export type VercelDeployment = {
  id: string
  url: string
  readyState: string
  createdAt: number
  target: string
  alias?: string[]
}

export type VercelDomain = {
  name: string
  verified: boolean
  verification?: Array<{ type: string; domain: string; value: string }>
}

export type CloudflareDnsRecord = {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
  ttl: number
  created_on: string
  modified_on: string
}

type CloudflareResponse<T> = {
  success: boolean
  errors: Array<{ code: number; message: string }>
  result: T
}

export type EnsureCnameResult = {
  action: "created" | "updated" | "exists" | "skipped"
  record?: CloudflareDnsRecord
  reason?: string
}

// ─── Service ─────────────────────────────────────────────────────────────────

const VERCEL_API_BASE = "https://api.vercel.com"
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4"

class DeploymentService {
  private log(level: "info" | "warn" | "error", msg: string, data?: any) {
    const prefix = `[DeploymentService]`
    if (data) {
      console[level](`${prefix} ${msg}`, data)
    } else {
      console[level](`${prefix} ${msg}`)
    }
  }

  // ── Configuration checks ────────────────────────────────────────────────

  isVercelConfigured(): boolean {
    return Boolean(process.env.VERCEL_TOKEN)
  }

  isCloudflareConfigured(): boolean {
    const configured = Boolean(
      process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID
    )
    if (!configured) {
      this.log("warn", "Cloudflare not configured", {
        hasToken: Boolean(process.env.CLOUDFLARE_API_TOKEN),
        hasZoneId: Boolean(process.env.CLOUDFLARE_ZONE_ID),
      })
    }
    return configured
  }

  // ── Vercel ──────────────────────────────────────────────────────────────

  private vercelHeaders(): Record<string, string> {
    const token = process.env.VERCEL_TOKEN
    if (!token) throw new Error("VERCEL_TOKEN environment variable is not set")
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  }

  private vercelTeamQuery(): string {
    const teamId = process.env.VERCEL_TEAM_ID
    return teamId ? `?teamId=${teamId}` : ""
  }

  sanitizeProjectName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100)
  }

  async createProject(input: {
    name: string
    gitRepo: string
    framework?: string
  }): Promise<VercelProject> {
    const projectName = this.sanitizeProjectName(input.name)
    const res = await fetch(`${VERCEL_API_BASE}/v11/projects${this.vercelTeamQuery()}`, {
      method: "POST",
      headers: this.vercelHeaders(),
      body: JSON.stringify({
        name: projectName,
        framework: input.framework || "nextjs",
        gitRepository: { type: "github", repo: input.gitRepo },
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Vercel createProject failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  async setEnvironmentVariables(
    projectId: string,
    envVars: Array<{
      key: string
      value: string
      type?: "plain" | "sensitive"
      target?: string[]
    }>
  ): Promise<void> {
    const payload = envVars.map((v) => ({
      key: v.key,
      value: v.value,
      type: v.type || "plain",
      target: v.target || ["production", "preview"],
    }))
    const res = await fetch(
      `${VERCEL_API_BASE}/v10/projects/${projectId}/env${this.vercelTeamQuery()}&upsert=true`,
      { method: "POST", headers: this.vercelHeaders(), body: JSON.stringify(payload) }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Vercel setEnvVars failed (${res.status}): ${body}`)
    }
  }

  async addDomain(projectId: string, domain: string): Promise<VercelDomain> {
    const res = await fetch(
      `${VERCEL_API_BASE}/v10/projects/${projectId}/domains${this.vercelTeamQuery()}`,
      { method: "POST", headers: this.vercelHeaders(), body: JSON.stringify({ name: domain }) }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Vercel addDomain failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  async removeDomain(projectId: string, domain: string): Promise<void> {
    const res = await fetch(
      `${VERCEL_API_BASE}/v9/projects/${projectId}/domains/${domain}${this.vercelTeamQuery()}`,
      { method: "DELETE", headers: this.vercelHeaders() }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Vercel removeDomain failed (${res.status}): ${body}`)
    }
  }

  async triggerDeployment(input: {
    projectName: string
    gitRepo: string
    ref?: string
  }): Promise<VercelDeployment> {
    const [org, repo] = input.gitRepo.split("/")
    const res = await fetch(
      `${VERCEL_API_BASE}/v13/deployments${this.vercelTeamQuery()}&forceNew=1&skipAutoDetectionConfirmation=1`,
      {
        method: "POST",
        headers: this.vercelHeaders(),
        body: JSON.stringify({
          name: this.sanitizeProjectName(input.projectName),
          target: "production",
          gitSource: { type: "github", org, repo, ref: input.ref || "main" },
        }),
      }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Vercel triggerDeployment failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  async getProject(projectId: string): Promise<VercelProject> {
    const res = await fetch(
      `${VERCEL_API_BASE}/v9/projects/${projectId}${this.vercelTeamQuery()}`,
      { method: "GET", headers: this.vercelHeaders() }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Vercel getProject failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  async getDeployment(deploymentId: string): Promise<VercelDeployment> {
    const res = await fetch(
      `${VERCEL_API_BASE}/v13/deployments/${deploymentId}${this.vercelTeamQuery()}`,
      { method: "GET", headers: this.vercelHeaders() }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Vercel getDeployment failed (${res.status}): ${body}`)
    }
    return res.json()
  }

  async deleteProject(projectId: string): Promise<void> {
    const res = await fetch(
      `${VERCEL_API_BASE}/v9/projects/${projectId}${this.vercelTeamQuery()}`,
      { method: "DELETE", headers: this.vercelHeaders() }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Vercel deleteProject failed (${res.status}): ${body}`)
    }
  }

  // ── Cloudflare ──────────────────────────────────────────────────────────

  private cloudflareHeaders(): Record<string, string> {
    const token = process.env.CLOUDFLARE_API_TOKEN
    if (!token) throw new Error("CLOUDFLARE_API_TOKEN environment variable is not set")
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  }

  private cloudflareZoneId(): string {
    const zoneId = process.env.CLOUDFLARE_ZONE_ID
    if (!zoneId) throw new Error("CLOUDFLARE_ZONE_ID environment variable is not set")
    return zoneId
  }

  async createDnsRecord(input: {
    name: string
    content: string
    type?: string
    proxied?: boolean
    ttl?: number
  }): Promise<CloudflareDnsRecord> {
    const zoneId = this.cloudflareZoneId()
    this.log("info", `Cloudflare createDnsRecord`, { zoneId: zoneId.slice(0, 8) + "...", name: input.name, content: input.content })
    const res = await fetch(`${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`, {
      method: "POST",
      headers: this.cloudflareHeaders(),
      body: JSON.stringify({
        type: input.type || "CNAME",
        name: input.name,
        content: input.content,
        proxied: input.proxied ?? false,
        ttl: input.ttl || 1,
      }),
    })
    const data: CloudflareResponse<CloudflareDnsRecord> = await res.json()
    if (!data.success) {
      const errMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown error"
      this.log("error", `Cloudflare createDnsRecord failed`, { errors: data.errors })
      throw new Error(`Cloudflare createDnsRecord failed: ${errMsg}`)
    }
    this.log("info", `Cloudflare createDnsRecord success`, { id: data.result.id })
    return data.result
  }

  async listDnsRecords(input: {
    name?: string
    type?: string
  }): Promise<CloudflareDnsRecord[]> {
    const zoneId = this.cloudflareZoneId()
    const params = new URLSearchParams()
    if (input.name) params.set("name", input.name)
    if (input.type) params.set("type", input.type)
    const res = await fetch(
      `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records?${params.toString()}`,
      { method: "GET", headers: this.cloudflareHeaders() }
    )
    const data: CloudflareResponse<CloudflareDnsRecord[]> = await res.json()
    if (!data.success) {
      throw new Error(`Cloudflare listDnsRecords failed: ${data.errors?.map((e) => e.message).join(", ") || "Unknown error"}`)
    }
    return data.result
  }

  async updateDnsRecord(
    recordId: string,
    input: { name: string; content: string; type?: string; proxied?: boolean; ttl?: number }
  ): Promise<CloudflareDnsRecord> {
    const zoneId = this.cloudflareZoneId()
    const res = await fetch(
      `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`,
      {
        method: "PUT",
        headers: this.cloudflareHeaders(),
        body: JSON.stringify({
          type: input.type || "CNAME",
          name: input.name,
          content: input.content,
          proxied: input.proxied ?? false,
          ttl: input.ttl || 1,
        }),
      }
    )
    const data: CloudflareResponse<CloudflareDnsRecord> = await res.json()
    if (!data.success) {
      throw new Error(`Cloudflare updateDnsRecord failed: ${data.errors?.map((e) => e.message).join(", ") || "Unknown error"}`)
    }
    return data.result
  }

  async deleteDnsRecord(recordId: string): Promise<void> {
    const zoneId = this.cloudflareZoneId()
    const res = await fetch(
      `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`,
      { method: "DELETE", headers: this.cloudflareHeaders() }
    )
    const data: CloudflareResponse<{ id: string }> = await res.json()
    if (!data.success) {
      throw new Error(`Cloudflare deleteDnsRecord failed: ${data.errors?.map((e) => e.message).join(", ") || "Unknown error"}`)
    }
  }

  // ── High-level operations ───────────────────────────────────────────────

  /**
   * Ensure a CNAME record exists for a subdomain pointing to Vercel.
   * Skips gracefully if Cloudflare is not configured.
   */
  async ensureVercelCname(
    subdomain: string,
    rootDomain: string
  ): Promise<EnsureCnameResult> {
    this.log("info", `ensureVercelCname called`, { subdomain, rootDomain })

    if (!this.isCloudflareConfigured()) {
      this.log("warn", "ensureVercelCname skipped — Cloudflare not configured")
      return { action: "skipped", reason: "Cloudflare not configured" }
    }

    const fullDomain = `${subdomain}.${rootDomain}`
    const vercelCname = "cname.vercel-dns.com"

    this.log("info", `Looking up existing CNAME for ${fullDomain}`)
    const existing = await this.listDnsRecords({ name: fullDomain, type: "CNAME" })
    this.log("info", `Found ${existing.length} existing records for ${fullDomain}`)

    if (existing.length > 0) {
      const record = existing[0]
      if (record.content === vercelCname) {
        this.log("info", `CNAME already points to Vercel: ${record.content}`)
        return { action: "exists", record }
      }
      this.log("info", `Updating CNAME from ${record.content} to ${vercelCname}`)
      const updated = await this.updateDnsRecord(record.id, {
        name: fullDomain,
        content: vercelCname,
        proxied: false,
      })
      this.log("info", `CNAME updated successfully`, { id: updated.id })
      return { action: "updated", record: updated }
    }

    this.log("info", `Creating new CNAME: ${fullDomain} → ${vercelCname}`)
    const created = await this.createDnsRecord({
      name: fullDomain,
      content: vercelCname,
      proxied: false,
    })
    this.log("info", `CNAME created successfully`, { id: created.id, name: created.name })
    return { action: "created", record: created }
  }

  /**
   * Remove DNS record for a storefront domain. Skips if Cloudflare is not configured.
   */
  async removeStorefrontDns(
    domain: string
  ): Promise<{ action: string; error?: string }> {
    if (!this.isCloudflareConfigured()) {
      return { action: "skipped" }
    }

    try {
      const records = await this.listDnsRecords({ name: domain, type: "CNAME" })
      if (records.length > 0) {
        await this.deleteDnsRecord(records[0].id)
        return { action: "deleted" }
      }
      return { action: "not_found" }
    } catch (e: any) {
      return { action: "failed", error: e.message }
    }
  }
}

export default DeploymentService
