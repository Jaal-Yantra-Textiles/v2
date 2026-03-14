const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4"

function getHeaders(): Record<string, string> {
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token) {
    throw new Error("CLOUDFLARE_API_TOKEN environment variable is not set")
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
}

function getZoneId(): string {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID
  if (!zoneId) {
    throw new Error("CLOUDFLARE_ZONE_ID environment variable is not set")
  }
  return zoneId
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

/**
 * Create a DNS record in Cloudflare.
 * For Vercel custom domains, creates a CNAME pointing to cname.vercel-dns.com.
 */
export async function createDnsRecord(input: {
  name: string
  content: string
  type?: string
  proxied?: boolean
  ttl?: number
}): Promise<CloudflareDnsRecord> {
  const zoneId = getZoneId()

  const res = await fetch(
    `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        type: input.type || "CNAME",
        name: input.name,
        content: input.content,
        proxied: input.proxied ?? false,
        ttl: input.ttl || 1, // 1 = automatic
      }),
    }
  )

  const data: CloudflareResponse<CloudflareDnsRecord> = await res.json()

  if (!data.success) {
    const errMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown error"
    throw new Error(`Cloudflare createDnsRecord failed: ${errMsg}`)
  }

  return data.result
}

/**
 * List DNS records matching a name filter.
 */
export async function listDnsRecords(input: {
  name?: string
  type?: string
}): Promise<CloudflareDnsRecord[]> {
  const zoneId = getZoneId()

  const params = new URLSearchParams()
  if (input.name) params.set("name", input.name)
  if (input.type) params.set("type", input.type)

  const res = await fetch(
    `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records?${params.toString()}`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  )

  const data: CloudflareResponse<CloudflareDnsRecord[]> = await res.json()

  if (!data.success) {
    const errMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown error"
    throw new Error(`Cloudflare listDnsRecords failed: ${errMsg}`)
  }

  return data.result
}

/**
 * Update an existing DNS record.
 */
export async function updateDnsRecord(
  recordId: string,
  input: {
    name: string
    content: string
    type?: string
    proxied?: boolean
    ttl?: number
  }
): Promise<CloudflareDnsRecord> {
  const zoneId = getZoneId()

  const res = await fetch(
    `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`,
    {
      method: "PUT",
      headers: getHeaders(),
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
    const errMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown error"
    throw new Error(`Cloudflare updateDnsRecord failed: ${errMsg}`)
  }

  return data.result
}

/**
 * Delete a DNS record.
 */
export async function deleteDnsRecord(recordId: string): Promise<void> {
  const zoneId = getZoneId()

  const res = await fetch(
    `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`,
    {
      method: "DELETE",
      headers: getHeaders(),
    }
  )

  const data: CloudflareResponse<{ id: string }> = await res.json()

  if (!data.success) {
    const errMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown error"
    throw new Error(`Cloudflare deleteDnsRecord failed: ${errMsg}`)
  }
}

/**
 * Check if Cloudflare credentials are configured.
 */
export function isCloudflareConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID)
}

/**
 * Ensure a CNAME record exists for a subdomain pointing to Vercel.
 * Creates the record if it doesn't exist, updates it if it points elsewhere.
 * Returns a "skipped" action if Cloudflare env vars are not configured.
 */
export async function ensureVercelCname(
  subdomain: string,
  rootDomain: string
): Promise<{ action: "created" | "updated" | "exists" | "skipped"; record?: CloudflareDnsRecord; reason?: string }> {
  if (!isCloudflareConfigured()) {
    return { action: "skipped", reason: "Cloudflare not configured (CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID missing)" }
  }

  const fullDomain = `${subdomain}.${rootDomain}`
  const vercelCname = "cname.vercel-dns.com"

  // Check if record already exists
  const existing = await listDnsRecords({ name: fullDomain, type: "CNAME" })

  if (existing.length > 0) {
    const record = existing[0]
    if (record.content === vercelCname) {
      return { action: "exists", record }
    }

    // Update to point to Vercel
    const updated = await updateDnsRecord(record.id, {
      name: fullDomain,
      content: vercelCname,
      proxied: false,
    })
    return { action: "updated", record: updated }
  }

  // Create new CNAME record
  const created = await createDnsRecord({
    name: fullDomain,
    content: vercelCname,
    proxied: false,
  })
  return { action: "created", record: created }
}
