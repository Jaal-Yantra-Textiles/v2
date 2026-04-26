import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

/**
 * Substitute $index / index placeholder in a JSON-serialised template string.
 * This mirrors the approach used in bulk-create-data.ts.
 */
function substituteIndex(template: any, index: number): any {
  const str = JSON.stringify(template)
    .replace(/\$index/g, String(index))
    .replace(/\bindex\b(?=[^\w])/g, String(index))
  return JSON.parse(str)
}

export const bulkHttpRequestOperation: OperationDefinition = {
  type: "bulk_http_request",
  name: "Bulk HTTP Request",
  description: "Make one HTTP request per item in an array — supports {{ item.field }} and $index in URL and body",
  icon: "globe-alt",
  category: "integration",

  optionsSchema: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
    /**
     * URL template — supports {{ item.field }} and $index.
     * e.g. "/admin/inventory-items/{{ item.id }}/rawmaterials"
     */
    url: z.string().describe("URL template. Use {{ item.field }} and $index for per-item values."),
    /**
     * Array source — literal array or {{ variable }} reference.
     */
    items: z
      .union([z.string(), z.array(z.any())])
      .describe("Array to iterate over, or a {{ variable }} reference to one"),
    /**
     * Body template per item. Supports {{ item.field }} and $index.
     */
    body: z
      .record(z.any())
      .optional()
      .describe("Body template. Use {{ item.field }} for per-item values."),
    headers: z.record(z.string()).optional().describe("Extra request headers"),
    timeout_ms: z.number().optional().default(30000),
    continue_on_error: z.boolean().optional().default(true),
    max_items: z.number().int().min(1).max(500).optional().default(100),
  }),

  defaultOptions: {
    method: "POST",
    url: "",
    items: [],
    body: {},
    continue_on_error: true,
    max_items: 100,
  },

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const continueOnError = Boolean(options.continue_on_error ?? true)
      const maxItems = Number(options.max_items ?? 100)
      const timeoutMs = Number(options.timeout_ms ?? 30000)

      // ── Resolve items array ──────────────────────────────────────────────────
      const resolvedItems = interpolateVariables(options.items, context.dataChain)
      if (!Array.isArray(resolvedItems)) {
        return {
          success: false,
          error: `'items' did not resolve to an array. Got: ${typeof resolvedItems}`,
        }
      }

      if (resolvedItems.length === 0) {
        return { success: true, data: { created: 0, failed: 0, records: [], results: [] } }
      }

      if (resolvedItems.length > maxItems) {
        return {
          success: false,
          error: `Too many items (${resolvedItems.length}). Max allowed is ${maxItems}.`,
        }
      }

      const baseHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...(interpolateVariables(options.headers || {}, context.dataChain) as Record<string, string>),
      }

      const results: Array<{ index: number; ok: boolean; record?: any; error?: string }> = []

      for (let i = 0; i < resolvedItems.length; i++) {
        const item = resolvedItems[i]

        try {
          // Build chain with current item exposed as $item / item
          const chainWithItem = { ...context.dataChain, $item: item, item }

          // Substitute $index then interpolate {{ }} variables
          const url = interpolateString(
            substituteIndex(options.url, i),
            chainWithItem
          )

          let body: any = undefined
          if (options.body && Object.keys(options.body).length > 0) {
            body = interpolateVariables(substituteIndex(options.body, i), chainWithItem)
          }

          console.log(`[bulk_http_request] [${i}/${resolvedItems.length}] ${options.method} ${url}`)

          const controller = new AbortController()
          const tid = setTimeout(() => controller.abort(), timeoutMs)

          let responseData: any
          let ok = false

          try {
            const response = await fetch(url, {
              method: options.method,
              headers: baseHeaders,
              body: body ? JSON.stringify(body) : undefined,
              signal: controller.signal,
            })
            clearTimeout(tid)

            const text = await response.text()
            if (text) {
              try { responseData = JSON.parse(text) } catch { responseData = text }
            } else {
              responseData = null
            }

            ok = response.ok
            if (!ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText} — ${typeof responseData === "string" ? responseData : JSON.stringify(responseData)}`)
            }
          } catch (fetchErr: any) {
            clearTimeout(tid)
            throw fetchErr
          }

          results.push({ index: i, ok: true, record: responseData })
        } catch (e: any) {
          const error = e?.message || "Unknown error"
          console.error(`[bulk_http_request] [${i}] failed:`, error)
          results.push({ index: i, ok: false, error })

          if (!continueOnError) {
            return {
              success: false,
              error,
              data: {
                created: results.filter((r) => r.ok).length,
                failed: results.filter((r) => !r.ok).length,
                records: results.filter((r) => r.ok).map((r) => r.record),
                results,
              },
            }
          }
        }
      }

      const created = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok).length

      return {
        success: failed === 0 || continueOnError,
        data: {
          created,
          failed,
          records: results.filter((r) => r.ok).map((r) => r.record),
          results,
        },
      }
    } catch (error: any) {
      return { success: false, error: error.message, errorStack: error.stack }
    }
  },
}
