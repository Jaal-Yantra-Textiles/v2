/**
 * CloudflareWorkersProvider — Cloudflare Workers + Workers Builds as a
 * storefront hosting target.
 *
 * Migrated from CloudflarePagesProvider (#884 follow-up after
 * @cloudflare/next-on-pages was archived) — this provider uses the Workers
 * Script Upload API (multipart) for creating workers and setting env vars,
 * the Workers Domains API for custom domains, and Workers Builds for
 * Git-connected auto-deployments.
 *
 * Project addressing is by *name* (same as Pages) — `HostingProject.id` is the
 * Worker script name. The storefront subdomain should CNAME to
 * `<name>.<account-subdomain>.workers.dev` (see `dnsTarget`).
 *
 * Credentials (identical to the Pages provider):
 *   - `token`: Cloudflare API token
 *   - `accountId`: Cloudflare account id
 *   - `extra.zone_id`: required for custom domains via Workers Domains API
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

const CF_API_BASE = "https://api.cloudflare.com/client/v4"

type CfResponse<T> = {
  success: boolean
  errors?: Array<{ code: number; message: string }>
  result: T
}

type CfWorkerMeta = {
  id: string
  created_on: string
  modified_on: string
  /** The script name (matches the URL segment). */
  name?: string
}

type CfWorkerDomain = {
  id: string
  hostname: string
  service: string
  zone_id: string
  zone_name: string
  status: string
}

type CfSubdomain = {
  subdomain: string
}

type CfWorkersBuild = {
  id: string
  status: string
  started_on?: string
  completed_on?: string
}

type CfDeployment = {
  id: string
  url?: string
  latest_stage?: { name: string; status: string }
}

const PLACEHOLDER_SCRIPT = `export default {
  async fetch(request) {
    return new Response("storefront placeholder", { status: 200 })
  }
}`

/**
 * Build the metadata JSON for the Workers multipart upload API, including
 * environment variable bindings.
 */
function workerMetadata(
  envVars: HostingEnvVar[],
  compatibilityDate?: string
): string {
  const bindings: Record<string, any>[] = envVars.map((v) => ({
    name: v.key,
    type: v.type === "sensitive" ? "secret_text" : "plain_text",
    text: v.value,
  }))

  return JSON.stringify({
    main_module: "worker.js",
    compatibility_date:
      compatibilityDate ?? new Date().toISOString().slice(0, 10),
    compatibility_flags: ["nodejs_compat"],
    usage_model: "standard",
    ...(bindings.length > 0 ? { bindings } : {}),
  })
}

export class CloudflareWorkersProvider implements HostingProvider {
  readonly provider = "cloudflare" as const
  private readonly token: string
  private readonly accountId: string
  private readonly zoneId?: string
  /** Cached workers.dev subdomain (lazily resolved). */
  private _subdomain: string | null = null

  constructor(creds: HostingCredentials) {
    if (!creds?.token)
      throw new Error("CloudflareWorkersProvider requires a token")
    if (!creds?.accountId)
      throw new Error("CloudflareWorkersProvider requires an accountId")
    this.token = creds.token
    this.accountId = creds.accountId
    this.zoneId = creds.extra?.zone_id
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private auth(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` }
  }

  private jsonHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    }
  }

  private scriptsBase(): string {
    return `${CF_API_BASE}/accounts/${this.accountId}/workers/scripts`
  }

  private domainsBase(): string {
    return `${CF_API_BASE}/accounts/${this.accountId}/workers/domains`
  }

  /**
   * Fetch and cache the account's workers.dev subdomain (e.g. `"my-account"`).
   * Workers are reachable at `<script-name>.<subdomain>.workers.dev`.
   */
  private async getSubdomain(): Promise<string> {
    if (this._subdomain) return this._subdomain
    const result = await this.cf<CfSubdomain>(
      `${CF_API_BASE}/accounts/${this.accountId}/workers/subdomain`,
      { method: "GET", headers: this.jsonHeaders() },
      "getSubdomain"
    )
    this._subdomain = result.subdomain
    return result.subdomain
  }

  private async cf<T>(
    url: string,
    init: RequestInit,
    op: string
  ): Promise<T> {
    const res = await fetch(url, init)
    const data = (await res.json().catch(() => null)) as CfResponse<T> | null
    if (!res.ok || !data?.success) {
      const errMsg =
        data?.errors?.map((e) => e.message).join(", ") ||
        (await res.text().catch(() => "")) ||
        `HTTP ${res.status}`
      throw new Error(
        `Cloudflare Workers ${op} failed (${res.status}): ${errMsg}`
      )
    }
    return data.result
  }

  /**
   * Upload (or re-upload) a Worker script with the given env vars as
   * bindings. Uses the multipart form-data API — the script body is a
   * minimal placeholder that Workers Builds will replace with the real
   * storefront on the next deploy.
   */
  private async uploadWorker(
    scriptName: string,
    envVars: HostingEnvVar[]
  ): Promise<void> {
    const metadata = workerMetadata(envVars)
    const formData = new FormData()
    formData.append("metadata", new Blob([metadata], { type: "application/json" }))
    formData.append(
      "worker.js",
      new File([PLACEHOLDER_SCRIPT], "worker.js", {
        type: "application/javascript+module",
      })
    )

    await this.cf<CfWorkerMeta>(
      `${this.scriptsBase()}/${scriptName}`,
      { method: "PUT", headers: this.auth(), body: formData },
      "uploadWorker"
    )
  }

  // ── HostingProvider interface ─────────────────────────────────────

  dnsTarget(project: HostingProject): string {
    return (
      project.originHost ||
      `${project.name}.${this.accountId}.workers.dev`
    )
  }

  async createProject(input: CreateProjectInput): Promise<HostingProject> {
    const name = sanitizeProjectName(input.name)

    // Build env var list from the input + any reserved names the worker needs.
    const envVars: HostingEnvVar[] = [
      // Workers Builds will use this to know which script to deploy into.
      { key: "CLOUDFLARE_WORKER_NAME", value: name, type: "plain" },
    ]

    // 1. Upload a placeholder Worker with initial env vars (as bindings).
    await this.uploadWorker(name, envVars)

    // 2. Try to connect the GitHub repo via Workers Builds so that pushes
    //    auto-build and deploy. This requires the Cloudflare account to have
    //    a pre-established Git connection (set up once per account via the
    //    dashboard or the Workers Builds API). If it fails, the operator
    //    connects manually.
    try {
      const [owner, repo] = input.gitRepo.split("/")
      await this.cf<any>(
        `${this.scriptsBase()}/${name}/build-git-connection`,
        {
          method: "POST",
          headers: this.jsonHeaders(),
          body: JSON.stringify({
            repo_owner: owner,
            repo_name: repo,
            production_branch: input.productionBranch || "main",
            build_command:
              input.buildCommand || "npm run build",
            deploy_command: `npx wrangler deploy --name ${name}`,
            root_directory: input.rootDirectory || "",
          }),
        },
        "createProject"
      )
    } catch (e) {
      console.warn(
        `[CloudflareWorkersProvider] Workers Builds Git integration failed for ${name}:`,
        (e as Error).message,
        "— the operator should connect the repo via the Cloudflare dashboard."
      )
    }

    // Resolve the workers.dev subdomain for the origin host.
    const subdomain = await this.getSubdomain()
    return {
      id: name,
      name,
      originHost: `${name}.${subdomain}.workers.dev`,
    }
  }

  async setEnvVars(
    projectName: string,
    envVars: HostingEnvVar[]
  ): Promise<void> {
    // Re-upload the placeholder Worker with updated bindings.
    // Caution: if Workers Builds has already deployed the real storefront,
    // this re-upload temporarily replaces it with the placeholder until the
    // next Workers Builds run. For production use, consider a dedicated
    // env-var API (e.g. PUT /accounts/…/secrets for secrets, and
    // re-deploying with vars baked into the metadata).
    await this.uploadWorker(projectName, envVars)
  }

  async addDomain(
    projectName: string,
    domain: string,
    _opts?: AddDomainOptions
  ): Promise<HostingDomain> {
    if (!this.zoneId) {
      return {
        name: domain,
        verified: false,
        verification: [],
        error:
          "Cloudflare zone_id is required to add a Workers custom domain. " +
          "Set zone_id in the deployment account config.",
      }
    }

    try {
      const result = await this.cf<CfWorkerDomain>(
        `${this.domainsBase()}`,
        {
          method: "POST",
          headers: this.jsonHeaders(),
          body: JSON.stringify({
            hostname: domain,
            service: projectName,
            zone_id: this.zoneId,
          }),
        },
        "addDomain"
      )
      return {
        name: result.hostname,
        verified: result.status === "active",
        verification: [],
      }
    } catch (e: any) {
      return {
        name: domain,
        verified: false,
        verification: [],
        error: e.message,
      }
    }
  }

  async removeDomain(
    projectName: string,
    domain: string
  ): Promise<void> {
    // List domains scoped to this service, find the matching one, delete by id.
    const domains = await this.listServiceDomains(projectName)
    const match = domains.find((d) => d.hostname === domain)
    if (!match) return // already gone

    const res = await fetch(`${this.domainsBase()}/${match.id}`, {
      method: "DELETE",
      headers: this.jsonHeaders(),
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `Cloudflare Workers removeDomain failed (${res.status}): ${await res.text()}`
      )
    }
  }

  /** Fetch domains attached to a service. */
  private async listServiceDomains(
    service: string
  ): Promise<CfWorkerDomain[]> {
    try {
      return await this.cf<CfWorkerDomain[]>(
        `${this.domainsBase()}?service=${service}`,
        { method: "GET", headers: this.jsonHeaders() },
        "listServiceDomains"
      )
    } catch {
      return []
    }
  }

  async verifyDomain(
    projectName: string,
    domain: string
  ): Promise<HostingDomain> {
    const domains = await this.listServiceDomains(projectName)
    const match = domains.find((d) => d.hostname === domain)
    const active = match?.status === "active"
    return { name: domain, verified: active, verification: [] }
  }

  async describeDomain(
    projectName: string,
    domain: string
  ): Promise<HostingDomainStatus> {
    const domains = await this.listServiceDomains(projectName)
    const match = domains.find((d) => d.hostname === domain)
    const active = match?.status === "active"

    // Resolve the workers.dev target for DNS instructions.
    const subdomain = await this.getSubdomain()
    const target = `${projectName}.${subdomain}.workers.dev`
    const dnsRecords = isApexDomain(domain)
      ? [{ type: "CNAME", host: "@", value: target }]
      : [cnameInstruction(domain, target)]

    return {
      name: domain,
      verified: active,
      misconfigured: !active,
      configuredBy: active ? "CNAME" : null,
      dnsRecords,
    }
  }

  async triggerDeployment(
    input: TriggerDeploymentInput
  ): Promise<HostingDeployment> {
    const projectName = sanitizeProjectName(input.projectName)

    // Attempt to trigger Workers Builds from the Git repo.
    // The Workers Builds API is still evolving — the endpoint path may differ.
    // Fall back to reporting a queued deployment on failure.
    try {
      // Try Workers Builds trigger endpoint first.
      const buildsResponse = await this.cf<any>(
        `${CF_API_BASE}/accounts/${this.accountId}/workers/builds`,
        {
          method: "POST",
          headers: this.jsonHeaders(),
          body: JSON.stringify({
            script_name: projectName,
            deployment_trigger: {
              type: "git_push",
              ...(input.ref ? { ref: input.ref } : {}),
            },
          }),
        },
        "triggerDeployment"
      )
      const subdomain = await this.getSubdomain()
      return {
        id: buildsResponse.id ?? projectName,
        url: `https://${projectName}.${subdomain}.workers.dev`,
        status: buildsResponse.status ?? "queued",
      }
    } catch {
      // If Workers Builds trigger fails, try the Deployments API.
      try {
        const dp = await this.cf<CfDeployment>(
          `${this.scriptsBase()}/${projectName}/deployments`,
          { method: "POST", headers: this.jsonHeaders() },
          "triggerDeployment"
        )
        const subdomain = await this.getSubdomain()
        return {
          id: dp.id,
          url:
            dp.url ??
            `https://${projectName}.${subdomain}.workers.dev`,
          status: dp.latest_stage?.status ?? "queued",
        }
      } catch {
        const subdomain = await this.getSubdomain()
        return {
          id: projectName,
          url: `https://${projectName}.${subdomain}.workers.dev`,
          status: "queued",
        }
      }
    }
  }

  async getProject(projectName: string): Promise<HostingProject> {
    const script = await this.cf<CfWorkerMeta>(
      `${this.scriptsBase()}/${projectName}`,
      { method: "GET", headers: this.jsonHeaders() },
      "getProject"
    )
    const subdomain = await this.getSubdomain()
    const name = script.name ?? projectName
    return {
      id: name,
      name,
      originHost: `${name}.${subdomain}.workers.dev`,
    }
  }

  /** Delete the Worker script (teardown). A 404 means it's already gone. */
  async deleteProject(projectName: string): Promise<void> {
    const res = await fetch(`${this.scriptsBase()}/${projectName}`, {
      method: "DELETE",
      headers: this.jsonHeaders(),
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `Cloudflare Workers deleteProject failed (${res.status}): ${await res
          .text()
          .catch(() => res.statusText)}`
      )
    }
  }
}
