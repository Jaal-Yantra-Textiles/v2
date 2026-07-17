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

  // ── Workers Builds (git-connected auto-deploy) ────────────────────
  //
  // The storefront is an OpenNext app (`@opennextjs/cloudflare`), so the build
  // pipeline is `opennextjs-cloudflare build && … deploy`, NOT `wrangler deploy`.
  // Workers Builds runs this on the Cloudflare side whenever `main` is pushed.
  //
  // Two account-level values are provisioned once (dashboard) and read from env:
  //   - CLOUDFLARE_GIT_CONNECTION_UUID — the repo connection (GitHub app auth)
  //   - CLOUDFLARE_BUILD_TOKEN_UUID    — the API token builds deploy with
  // A single repo connection covers every storefront (all build the same repo).

  private buildsBase(): string {
    return `${CF_API_BASE}/accounts/${this.accountId}/builds`
  }

  /** The build-trigger config that makes a storefront Worker deploy on push. */
  private static readonly BUILD_COMMAND = "npx opennextjs-cloudflare build"

  /**
   * Deploy command for a partner's Worker. The storefront repo's `wrangler.jsonc`
   * hardcodes `name: "storefront-starter"`, so every partner would otherwise
   * deploy onto the SAME worker. Passing `-- --name <script>` forwards the
   * per-partner worker name to `wrangler deploy` so each partner lands on its own
   * `storefront-<handle>` worker.
   */
  private static deployCommand(scriptName: string): string {
    return `npx opennextjs-cloudflare deploy -- --name ${scriptName}`
  }

  private gitConnectionUuid(): string | undefined {
    return process.env.CLOUDFLARE_GIT_CONNECTION_UUID
  }
  private buildTokenUuid(): string | undefined {
    return process.env.CLOUDFLARE_BUILD_TOKEN_UUID
  }

  /** Look up a Worker's build tag (external_script_id) by script name. */
  private async getWorkerTag(scriptName: string): Promise<string | null> {
    try {
      const scripts = await this.cf<Array<{ id: string; tag?: string }>>(
        `${this.scriptsBase()}`,
        { method: "GET", headers: this.jsonHeaders() },
        "getWorkerTag"
      )
      return scripts.find((s) => s.id === scriptName)?.tag ?? null
    } catch {
      return null
    }
  }

  /** The production build trigger for a Worker (the one that includes `main`). */
  private async findProductionTrigger(
    workerTag: string
  ): Promise<{ trigger_uuid: string; branch_includes?: string[] } | null> {
    try {
      const triggers = await this.cf<
        Array<{ trigger_uuid: string; branch_includes?: string[] }>
      >(
        `${this.buildsBase()}/workers/${workerTag}/triggers`,
        { method: "GET", headers: this.jsonHeaders() },
        "listTriggers"
      )
      return (
        triggers.find((t) => (t.branch_includes ?? []).includes("main")) ??
        triggers[0] ??
        null
      )
    } catch {
      return null
    }
  }

  /**
   * Ensure a production Workers Builds trigger exists for the Worker, creating
   * it if the git-connection + build-token env vars are configured. Returns the
   * worker tag + trigger uuid, or null if builds can't be wired (env missing or
   * the worker has no tag yet) — caller logs and continues.
   */
  private async ensureBuildTrigger(
    scriptName: string,
    branch: string,
    rootDir: string
  ): Promise<{ workerTag: string; triggerUuid: string } | null> {
    const repoConnectionUuid = this.gitConnectionUuid()
    const buildTokenUuid = this.buildTokenUuid()
    if (!repoConnectionUuid || !buildTokenUuid) return null

    const workerTag = await this.getWorkerTag(scriptName)
    if (!workerTag) return null

    const existing = await this.findProductionTrigger(workerTag)
    if (existing) return { workerTag, triggerUuid: existing.trigger_uuid }

    const trigger = await this.cf<{ trigger_uuid: string }>(
      `${this.buildsBase()}/triggers`,
      {
        method: "POST",
        headers: this.jsonHeaders(),
        body: JSON.stringify({
          external_script_id: workerTag,
          repo_connection_uuid: repoConnectionUuid,
          build_token_uuid: buildTokenUuid,
          trigger_name: "Deploy production",
          build_command: CloudflareWorkersProvider.BUILD_COMMAND,
          deploy_command: CloudflareWorkersProvider.deployCommand(scriptName),
          root_directory: rootDir || "/",
          // Production only — this is also the #1027 fix for Workers: feature
          // branches on the shared storefront repo never fan out a build.
          branch_includes: [branch],
          branch_excludes: [],
          path_includes: ["*"],
          path_excludes: [],
        }),
      },
      "createTrigger"
    )
    return { workerTag, triggerUuid: trigger.trigger_uuid }
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

    // 1. Upload a placeholder Worker so the script exists (and gets a build
    //    tag). Workers Builds replaces this with the real OpenNext bundle on the
    //    first build.
    await this.uploadWorker(name, envVars)

    // 2. Wire a production Workers Builds trigger so pushes to `main` auto-build
    //    and deploy the OpenNext storefront. No-op (with a warning) when the
    //    account-level git-connection / build-token env vars aren't configured —
    //    the worker still exists, just without auto-deploy.
    const branch = input.productionBranch || "main"
    const built = await this.ensureBuildTrigger(
      name,
      branch,
      input.rootDirectory || "/"
    ).catch((e) => {
      console.warn(
        `[CloudflareWorkersProvider] Workers Builds trigger setup failed for ${name}: ${(e as Error).message}`
      )
      return null
    })
    if (!built) {
      console.warn(
        `[CloudflareWorkersProvider] ${name}: no Workers Builds trigger created ` +
          `(set CLOUDFLARE_GIT_CONNECTION_UUID + CLOUDFLARE_BUILD_TOKEN_UUID). ` +
          `The storefront will serve the placeholder until a build is wired.`
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
    // Set env vars on the Workers Builds production trigger — NOT by re-uploading
    // the script (which would clobber the deployed storefront back to the
    // placeholder). The storefront's config is all NEXT_PUBLIC_* (build-time,
    // baked into the OpenNext bundle), so trigger env vars are exactly the right
    // place. If no trigger exists yet (builds not wired), skip — the vars will be
    // set on the next createProject/build-trigger pass rather than clobbering.
    const name = sanitizeProjectName(projectName)
    const workerTag = await this.getWorkerTag(name)
    const trigger = workerTag ? await this.findProductionTrigger(workerTag) : null
    if (!trigger) {
      console.warn(
        `[CloudflareWorkersProvider] setEnvVars(${name}): no build trigger yet — ` +
          `env vars not applied (wire Workers Builds first).`
      )
      return
    }

    const body: Record<string, { value: string; is_secret: boolean }> = {}
    for (const v of envVars) {
      body[v.key] = { value: v.value, is_secret: v.type === "sensitive" }
    }
    await this.cf<unknown>(
      `${this.buildsBase()}/triggers/${trigger.trigger_uuid}/environment_variables`,
      { method: "PATCH", headers: this.jsonHeaders(), body: JSON.stringify(body) },
      "setEnvVars"
    )
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
    const branch = input.ref || "main"
    const subdomain = await this.getSubdomain()
    const url = `https://${projectName}.${subdomain}.workers.dev`

    // Ensure the build trigger exists (creates it if createProject couldn't —
    // e.g. env creds were added after provisioning), then fire a real build via
    // the Workers Builds API. No fabricated "queued" success: if builds aren't
    // wired we report "skipped" so the caller sees the storefront isn't live.
    const built = await this.ensureBuildTrigger(projectName, branch, "/").catch(
      () => null
    )
    if (!built) {
      return { id: projectName, url, status: "skipped" }
    }

    const build = await this.cf<{ build_uuid?: string; id?: string; status?: string }>(
      `${this.buildsBase()}/triggers/${built.triggerUuid}/builds`,
      {
        method: "POST",
        headers: this.jsonHeaders(),
        body: JSON.stringify({ branch }),
      },
      "triggerDeployment"
    )
    return {
      id: build.build_uuid ?? build.id ?? built.triggerUuid,
      url,
      status: build.status ?? "queued",
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
