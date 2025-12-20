import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import yaml from "js-yaml"
import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi"
import { buildRegistry } from "../custom/registry"
import { CATALOG_CACHE_CONFIG } from "../../../../../mastra/config/cache"

// Simple in-memory cache
let CACHE: { data: any; fetchedAt: number } | null = null
const TTL_MS = CATALOG_CACHE_CONFIG.TTL_MS

// Source of truth: Medusa Admin OpenAPI (full)
const OPENAPI_URL =
  "https://raw.githubusercontent.com/medusajs/medusa/refs/heads/develop/www/apps/api-reference/specs/admin/openapi.full.yaml"

function summarizeSchema(schema: any): any {
  try {
    if (!schema || typeof schema !== "object") return undefined
    if (schema.$ref) return { $ref: schema.$ref }
    if (schema.oneOf) return { oneOf: (schema.oneOf || []).slice(0, 5).map((s: any) => summarizeSchema(s)).filter(Boolean) }
    if (schema.anyOf) return { anyOf: (schema.anyOf || []).slice(0, 5).map((s: any) => summarizeSchema(s)).filter(Boolean) }
    if (schema.allOf) return { allOf: (schema.allOf || []).slice(0, 5).map((s: any) => summarizeSchema(s)).filter(Boolean) }
    if (schema.type === "array") return { type: "array", items: summarizeSchema(schema.items) }
    if (schema.type === "object") {
      const props = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties).slice(0, 12) : []
      return {
        type: "object",
        required: Array.isArray(schema.required) ? schema.required.slice(0, 12) : undefined,
        properties: props.length ? props.reduce((acc: any, k: string) => {
          acc[k] = summarizeSchema(schema.properties[k])
          return acc
        }, {}) : undefined,
      }
    }
    if (schema.type) return { type: schema.type }
    return undefined
  } catch {
    return undefined
  }
}

function extractResponseSchema(op: any): any {
  try {
    const responses = op?.responses || {}
    const preferred = ["200", "201", "202", "204"]
    const code = preferred.find((c) => responses?.[c]) || (responses?.default ? "default" : undefined) || Object.keys(responses || {})[0]
    if (!code) return undefined
    const resp = responses?.[code]
    const content = resp?.content || {}
    const appJson = content["application/json"] || content["application/ld+json"]
    const schema = appJson?.schema
    return summarizeSchema(schema)
  } catch {
    return undefined
  }
}

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

    // Merge in custom admin routes so catalog includes project-specific endpoints
    // (e.g. /admin/designs) that are not present in Medusa core spec.
    try {
      const registry = buildRegistry()
      const generator = new OpenApiGeneratorV31(registry.definitions)
      const customDoc = generator.generateDocument({
        openapi: "3.1.0",
        info: {
          title: "JYT Admin APIs (Custom)",
          version: "1.0.0",
          description: "OpenAPI specification for custom admin routes under src/api/admin.",
        },
        servers: [{ url: "/admin", description: "Admin API base" }],
        security: [{ bearerAuth: [] }],
      }) as any

      const basePaths = (doc?.paths && typeof doc.paths === "object") ? doc.paths : {}
      const addPaths = (customDoc?.paths && typeof customDoc.paths === "object") ? customDoc.paths : {}
      for (const [p, methods] of Object.entries<any>(addPaths)) {
        if (!basePaths[p]) {
          basePaths[p] = methods
          continue
        }
        const existing = basePaths[p] || {}
        const incoming = methods || {}
        for (const [m, op] of Object.entries<any>(incoming)) {
          existing[m] = op
        }
        basePaths[p] = existing
      }
      doc.paths = basePaths
    } catch (e: any) {
      try { console.warn("[openapi][catalog] failed to merge custom spec", e?.message || e) } catch { }
    }

    const items: Array<{
      id: string
      method: string
      path: string
      summary: string
      tags?: string[]
      description?: string
      operationId?: string
      pathParams?: string[]
      queryParams?: string[]
      queryParamsSchema?: Array<{ name: string; required?: boolean; schema?: any; description?: string }>
      requestBodyRequired?: boolean
      requestBodySchema?: any
      responseBodySchema?: any
      responseCodes?: string[]
      security?: any
      authenticated?: boolean
    }> = []

    const paths = doc?.paths || {}
    for (const [p, methods] of Object.entries<any>(paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        const httpMethod = method.toUpperCase()
        if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(httpMethod)) continue
        const summary: string = op?.summary || op?.operationId || `${httpMethod} ${p}`
        const tags: string[] | undefined = Array.isArray(op?.tags) ? op.tags : undefined
        const description: string | undefined = op?.description
        const operationId: string | undefined = op?.operationId
        const authenticated: boolean | undefined = typeof op?.["x-authenticated"] === "boolean" ? op["x-authenticated"] : undefined
        const security: any = op?.security
        const responseCodes: string[] | undefined = op?.responses && typeof op.responses === "object" ? Object.keys(op.responses) : undefined
        const responseBodySchema = extractResponseSchema(op)
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
          description,
          operationId,
          pathParams,
          queryParams,
          queryParamsSchema,
          requestBodyRequired,
          requestBodySchema,
          responseBodySchema,
          responseCodes,
          security,
          authenticated,
        })
      }
    }

    CACHE = { data: items, fetchedAt: Date.now() }
    return res.json({ items })
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || "openapi catalog error" })
  }
}
