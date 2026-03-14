const VERCEL_API_BASE = "https://api.vercel.com"

function getHeaders(): Record<string, string> {
  const token = process.env.VERCEL_TOKEN
  if (!token) {
    throw new Error("VERCEL_TOKEN environment variable is not set")
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
}

function teamQuery(): string {
  const teamId = process.env.VERCEL_TEAM_ID
  return teamId ? `?teamId=${teamId}` : ""
}

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

/**
 * Sanitize a project name to comply with Vercel's rules:
 * - lowercase only
 * - letters, digits, '.', '_', '-' allowed
 * - no '---' sequence
 * - max 100 chars
 * - no leading/trailing dashes
 */
function sanitizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100)
}

export async function createProject(input: {
  name: string
  gitRepo: string // "org/repo" format
  framework?: string
}): Promise<VercelProject> {
  const projectName = sanitizeProjectName(input.name)

  const res = await fetch(`${VERCEL_API_BASE}/v11/projects${teamQuery()}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      name: projectName,
      framework: input.framework || "nextjs",
      gitRepository: {
        type: "github",
        repo: input.gitRepo,
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vercel createProject failed (${res.status}): ${body}`)
  }

  return res.json()
}

export async function setEnvironmentVariables(
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
    `${VERCEL_API_BASE}/v10/projects/${projectId}/env${teamQuery()}&upsert=true`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vercel setEnvVars failed (${res.status}): ${body}`)
  }
}

export async function addDomain(
  projectId: string,
  domain: string
): Promise<VercelDomain> {
  const res = await fetch(
    `${VERCEL_API_BASE}/v10/projects/${projectId}/domains${teamQuery()}`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ name: domain }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vercel addDomain failed (${res.status}): ${body}`)
  }

  return res.json()
}

export async function triggerDeployment(input: {
  projectName: string
  gitRepo: string // "org/repo" format
  ref?: string
}): Promise<VercelDeployment> {
  const [org, repo] = input.gitRepo.split("/")

  const res = await fetch(
    `${VERCEL_API_BASE}/v13/deployments${teamQuery()}&forceNew=1&skipAutoDetectionConfirmation=1`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        name: sanitizeProjectName(input.projectName),
        target: "production",
        gitSource: {
          type: "github",
          org,
          repo,
          ref: input.ref || "main",
        },
      }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vercel triggerDeployment failed (${res.status}): ${body}`)
  }

  return res.json()
}

export async function getProject(projectId: string): Promise<VercelProject> {
  const res = await fetch(
    `${VERCEL_API_BASE}/v9/projects/${projectId}${teamQuery()}`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vercel getProject failed (${res.status}): ${body}`)
  }

  return res.json()
}

export async function getDeployment(deploymentId: string): Promise<VercelDeployment> {
  const res = await fetch(
    `${VERCEL_API_BASE}/v13/deployments/${deploymentId}${teamQuery()}`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vercel getDeployment failed (${res.status}): ${body}`)
  }

  return res.json()
}

/**
 * Remove a custom domain from a Vercel project.
 */
export async function removeDomain(
  projectId: string,
  domain: string
): Promise<void> {
  const res = await fetch(
    `${VERCEL_API_BASE}/v9/projects/${projectId}/domains/${domain}${teamQuery()}`,
    {
      method: "DELETE",
      headers: getHeaders(),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vercel removeDomain failed (${res.status}): ${body}`)
  }
}

/**
 * Delete a Vercel project entirely.
 */
export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(
    `${VERCEL_API_BASE}/v9/projects/${projectId}${teamQuery()}`,
    {
      method: "DELETE",
      headers: getHeaders(),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vercel deleteProject failed (${res.status}): ${body}`)
  }
}

/**
 * Check if Vercel credentials are configured.
 */
export function isVercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN)
}
