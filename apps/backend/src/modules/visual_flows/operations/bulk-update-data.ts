import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

function capitalize(str: string): string {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export const bulkUpdateDataOperation: OperationDefinition = {
  type: "bulk_update_data",
  name: "Bulk Update Data",
  description: "Update many records in a module in one step",
  icon: "pencil-square",
  category: "data",

  optionsSchema: z.object({
    module: z.string().describe("Module identifier"),
    collection: z.string().describe("Collection/entity name"),
    items: z
      .array(
        z.object({
          selector: z.record(z.any()).optional().describe("Selector to find record (e.g., { id: '...' })"),
          data: z.record(z.any()).describe("Data to update"),
        })
      )
      .describe("Update items"),
    continue_on_error: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true, continues processing remaining items when an update fails"),
    max_items: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .default(200)
      .describe("Maximum items allowed per execution"),
  }),

  defaultOptions: {
    module: "",
    collection: "",
    items: [],
    continue_on_error: true,
    max_items: 200,
  },

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const moduleName = interpolateString(options.module, context.dataChain)
      const collection = interpolateString(options.collection, context.dataChain)
      const continueOnError = Boolean(options.continue_on_error ?? true)
      const maxItems = Number(options.max_items ?? 200)

      const service = context.container.resolve(moduleName) as any

      if (!service) {
        return {
          success: false,
          error: `Module '${moduleName}' not found`,
        }
      }

      const methodName = `update${capitalize(collection)}`

      if (typeof service[methodName] !== "function") {
        return {
          success: false,
          error: `Method '${methodName}' not found on module '${moduleName}'`,
        }
      }

      const rawItems = Array.isArray(options.items) ? options.items : []
      const items = interpolateVariables(rawItems, context.dataChain) as Array<{
        selector?: Record<string, any>
        data: Record<string, any>
      }>

      if (items.length > maxItems) {
        return {
          success: false,
          error: `Too many items (${items.length}). Max allowed is ${maxItems}.`,
        }
      }

      const results: Array<{ index: number; ok: boolean; result?: any; error?: string }> = []

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const selector = item?.selector || {}
        const data = item?.data || {}

        try {
          let result: any

          if (selector?.id) {
            try {
              result = await service[methodName](selector.id, data)
            } catch (e) {
              result = await service[methodName]({ id: selector.id, ...data })
            }
          } else {
            try {
              result = await service[methodName](selector, data)
            } catch (e) {
              result = await service[methodName]({ selector, data })
            }
          }

          results.push({ index: i, ok: true, result })
        } catch (e: any) {
          const error = e?.message || "Unknown error"
          results.push({ index: i, ok: false, error })

          if (!continueOnError) {
            return {
              success: false,
              error,
              data: {
                processed: i + 1,
                results,
              },
            }
          }
        }
      }

      const updated = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok).length

      return {
        success: failed === 0,
        data: {
          updated,
          failed,
          results,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        errorStack: error.stack,
      }
    }
  },
}
