/**
 * CloudflarePagesProvider — Cloudflare Pages as a storefront hosting target
 * (the new default for new partners, #884). Uses the Pages REST API:
 *   - project ← GitHub repo (source config)
 *   - env vars via the project's production/preview deployment configs
 *   - custom domain (verified automatically once the CNAME resolves)
 *   - deployment trigger
 *
 * Unlike Vercel, Pages addresses projects by *name* (not an opaque id) in its
 * URLs, so `HostingProject.id` is the project name here. The storefront
 * subdomain should CNAME to `<project>.pages.dev` (see `dnsTarget`).
 *
 * Credentials are per-account (decrypted from `deployment_account.api_config`):
 * a Cloudflare API token + the account id.
 */

import type {
  CreateProjectInput,
  HostingCredentials,
  HostingDeployment,
  HostingDomain,
  HostingEnvVar,
  HostingProject,
  HostingProvider,
  TriggerDeploymentInput,
} from "./types"
import { sanitizeProjectName } from "./types"

const CF_API_BASE = "https://api.cloudflare.com/client/v4"

type CfResponse<T> = {
  success: boolean
  errors?: Array<{ code: number; message: string }>
  result: T
}

type CfPagesProject = {
  id: string
  name: string
  subdomain: string // "<project>.pages.dev"
  production_branch?: string
}

type CfPagesDeployment = {
  id: string
  url: string
  latest_stage?: { name: string; status: string }
}

export class CloudflarePagesProvider implements HostingProvider {
  readonly provider = "cloudflare" as const
  private readonly token: string
  private readonly accountId: string

  constructor(creds: HostingCredentials) {
    if (!creds?.token) throw new Error("CloudflarePagesProvider requires a token")
    if (!creds?.accountId) throw new Error("CloudflarePagesProvider requires an accountId")
    this.token = creds.token
    this.accountId = creds.accountId
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }
  }

  private base(): string {
    return `${CF_API_BASE}/accounts/${this.accountId}/pages/projects`
  }

  private async cf<T>(url: string, init: RequestInit, op: string): Promise<T> {
    const res = await fetch(url, { ...init, headers: this.headers() })
    const data = (await res.json().catch(() => null)) as CfResponse<T> | null
    if (!res.ok || !data?.success) {
      const errMsg =
        data?.errors?.map((e) => e.message).join(", ") ||
        (await res.text().catch(() => "")) ||
        `HTTP ${res.status}`
      throw new Error(`Cloudflare Pages ${op} failed (${res.status}): ${errMsg}`)
    }
    return data.result
  }

  dnsTarget(project: HostingProject): string {
    // Prefer the exact subdomain the API returned; fall back to the convention.
    return project.originHost || `${project.name}.pages.dev`
  }

  async createProject(input: CreateProjectInput): Promise<HostingProject> {
    const name = sanitizeProjectName(input.name)
    const branch = input.productionBranch || "main"
    const [owner, repoName] = input.gitRepo.split("/")

    const payload: Record<string, any> = {
      name,
      production_branch: branch,
      source: {
        type: "github",
        config: {
          owner,
          repo_name: repoName,
          production_branch: branch,
          pr_comments_enabled: false,
          deployments_enabled: true,
        },
      },
      build_config: {
        build_command: input.buildCommand || "pnpm build",
        destination_dir: ".next",
        root_dir: input.rootDirectory || "",
      },
    }

    const project = await this.cf<CfPagesProject>(
      `${this.base()}`,
      { method: "POST", body: JSON.stringify(payload) },
      "createProject"
    )
    return { id: project.name, name: project.name, originHost: project.subdomain }
  }

  async setEnvVars(projectName: string, envVars: HostingEnvVar[]): Promise<void> {
    // Pages stores env vars inside deployment_configs; PATCH merges them into
    // both production and preview so the storefront builds identically.
    const env_vars: Record<string, { value: string; type: "plain_text" | "secret_text" }> = {}
    for (const v of envVars) {
      env_vars[v.key] = {
        value: v.value,
        type: v.type === "sensitive" ? "secret_text" : "plain_text",
      }
    }
    await this.cf<CfPagesProject>(
      `${this.base()}/${projectName}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          deployment_configs: {
            production: { env_vars },
            preview: { env_vars },
          },
        }),
      },
      "setEnvVars"
    )
  }

  async addDomain(projectName: string, domain: string): Promise<HostingDomain> {
    try {
      const result = await this.cf<{ name: string; status?: string }>(
        `${this.base()}/${projectName}/domains`,
        { method: "POST", body: JSON.stringify({ name: domain }) },
        "addDomain"
      )
      // Pages verifies automatically once the CNAME resolves — no TXT records
      // to publish, so `verification` is empty. Verified flips true after DNS
      // propagates.
      return { name: result.name, verified: result.status === "active", verification: [] }
    } catch (e: any) {
      return { name: domain, verified: false, verification: [], error: e.message }
    }
  }

  async triggerDeployment(input: TriggerDeploymentInput): Promise<HostingDeployment> {
    const projectName = sanitizeProjectName(input.projectName)
    const d = await this.cf<CfPagesDeployment>(
      `${this.base()}/${projectName}/deployments`,
      { method: "POST" },
      "triggerDeployment"
    )
    return {
      id: d.id,
      url: d.url,
      status: d.latest_stage?.status || "queued",
    }
  }

  async getProject(projectName: string): Promise<HostingProject> {
    const p = await this.cf<CfPagesProject>(
      `${this.base()}/${projectName}`,
      { method: "GET" },
      "getProject"
    )
    return { id: p.name, name: p.name, originHost: p.subdomain }
  }
}
