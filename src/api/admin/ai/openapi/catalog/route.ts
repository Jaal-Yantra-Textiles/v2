import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import yaml from "js-yaml"

// Simple in-memory cache
let CACHE: { data: any; fetchedAt: number } | null = null
const TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

// Source of truth: Medusa Admin OpenAPI (full)
const OPENAPI_URL =
  "https://raw.githubusercontent.com/medusajs/medusa/refs/heads/develop/www/apps/api-reference/specs/admin/openapi.full.yaml"

function extractPathParams(path: string): string[] {
  const params: string[] = []
  const re = /\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(path))) {
    params.push(m[1])
  }
  return params
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    // Serve from cache when fresh
    if (CACHE && Date.now() - CACHE.fetchedAt < TTL_MS) {
      return res.json({ items: CACHE.data })
    }

    const r = await fetch(OPENAPI_URL, { method: "GET" })
    if (!r.ok) {
      return res.status(502).json({ message: `Failed to fetch OpenAPI: ${r.status}` })
    }
    const text = await r.text()
    const doc = yaml.load(text) as any

    const items: Array<{
      id: string
      method: string
      path: string
      summary: string
      tags?: string[]
      pathParams?: string[]
      queryParams?: string[]
      queryParamsSchema?: Array<{ name: string; required?: boolean; schema?: any; description?: string }>
      requestBodyRequired?: boolean
      requestBodySchema?: any
    }> = []

    const paths = doc?.paths || {}
    for (const [p, methods] of Object.entries<any>(paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        const httpMethod = method.toUpperCase()
        if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(httpMethod)) continue
        const summary: string = op?.summary || op?.operationId || `${httpMethod} ${p}`
        const tags: string[] | undefined = Array.isArray(op?.tags) ? op.tags : undefined
        const pathParams = extractPathParams(p)
        const queryParams: string[] = []
        const queryParamsSchema: Array<{ name: string; required?: boolean; schema?: any; description?: string }> = []
        const params = Array.isArray(op?.parameters) ? op.parameters : []
        for (const prm of params) {
          if (prm?.in === "query" && prm?.name) {
            queryParams.push(prm.name)
            queryParamsSchema.push({ name: prm.name, required: prm.required, schema: prm.schema, description: prm.description })
          }
        }

        // Request body (take application/json if present)
        let requestBodyRequired = false
        let requestBodySchema: any = undefined
        const rb = op?.requestBody
        if (rb) {
          requestBodyRequired = !!rb.required
          const content = rb.content || {}
          const appJson = content["application/json"] || content["application/x-www-form-urlencoded"]
          if (appJson?.schema) {
            requestBodySchema = appJson.schema // leave as-is; client can introspect required/properties
          }
        }

        const baseId = (op?.operationId || `${httpMethod}_${p.replace(/[^a-zA-Z0-9]+/g, "_")}`).toLowerCase()
        const id = baseId.replace(/^_+|_+$/g, "")
        items.push({
          id,
          method: httpMethod,
          path: p,
          summary,
          tags,
          pathParams,
          queryParams,
          queryParamsSchema,
          requestBodyRequired,
          requestBodySchema,
        })
      }
    }

    CACHE = { data: items, fetchedAt: Date.now() }
    return res.json({ items })
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || "openapi catalog error" })
  }
}
