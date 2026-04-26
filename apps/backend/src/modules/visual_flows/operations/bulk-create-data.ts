import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

function capitalize(str: string): string {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export const bulkCreateDataOperation: OperationDefinition = {
  type: "bulk_create_data",
  name: "Bulk Create Data",
  description: "Create multiple records from an array — one record per item",
  icon: "squares-plus",
  category: "data",

  optionsSchema: z.object({
    module: z.string().describe("Module identifier (e.g., 'inventory', 'raw_materials')"),
    collection: z.string().describe("Collection/entity name (e.g., 'InventoryItems', 'RawMaterials')"),
    /**
     * Either a literal array or a {{ variable }} reference that resolves to an array.
     * Each element becomes the input to one create call.
     */
    items: z
      .union([z.string(), z.array(z.any())])
      .describe(
        "Array of records to create, or a {{ variable }} reference to an array in the data chain"
      ),
    /**
     * Optional template applied to each item before creation.
     * Supports {{ item.field }} references to the current item's fields
     * AND all other {{ operation_key.field }} references to the data chain.
     * When omitted the item is used as-is.
     */
    item_template: z
      .record(z.any())
      .optional()
      .describe(
        "Shape of each record to create. Use {{ item.field }} to reference the current item, " +
        "e.g. { title: '{{ item.material_name }}', material: '{{ item.composition }}' }"
      ),
    continue_on_error: z
      .boolean()
      .optional()
      .default(true)
      .describe("Continue processing remaining items when a single create fails"),
    max_items: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .default(100)
      .describe("Safety cap on array length"),
  }),

  defaultOptions: {
    module: "",
    collection: "",
    items: [],
    continue_on_error: true,
    max_items: 100,
  },

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const moduleName = interpolateString(options.module, context.dataChain)
      const collection = interpolateString(options.collection, context.dataChain)
      const continueOnError = Boolean(options.continue_on_error ?? true)
      const maxItems = Number(options.max_items ?? 100)

      // ── Resolve the items array ──────────────────────────────────────────────
      // options.items may be:
      //   - a string like "{{ extract_order.items }}" → resolves to array
      //   - a literal array (possibly containing {{ }} strings)
      let rawItems: any[]
      const resolvedItems = interpolateVariables(options.items, context.dataChain)

      if (Array.isArray(resolvedItems)) {
        rawItems = resolvedItems
      } else {
        return {
          success: false,
          error: `'items' did not resolve to an array. Got: ${typeof resolvedItems}`,
        }
      }

      if (rawItems.length === 0) {
        return {
          success: true,
          data: { created: 0, failed: 0, records: [], results: [] },
        }
      }

      if (rawItems.length > maxItems) {
        return {
          success: false,
          error: `Too many items (${rawItems.length}). Max allowed is ${maxItems}.`,
        }
      }

      // ── Resolve module service ───────────────────────────────────────────────
      const service = context.container.resolve(moduleName) as any
      if (!service) {
        return { success: false, error: `Module '${moduleName}' not found` }
      }

      const methodName = `create${capitalize(collection)}`
      if (typeof service[methodName] !== "function") {
        return {
          success: false,
          error: `Method '${methodName}' not found on module '${moduleName}'`,
        }
      }

      // ── Process each item ────────────────────────────────────────────────────
      const results: Array<{ index: number; ok: boolean; record?: any; error?: string }> = []

      for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i]

        try {
          let dataToCreate: Record<string, any>

          if (options.item_template && Object.keys(options.item_template).length > 0) {
            // Substitute $index with the actual number so path expressions like
            // {{ create_inventory_items.records[$index].id }} resolve correctly.
            const templateStr = JSON.stringify(options.item_template)
              .replace(/\$index/g, String(i))
              .replace(/\bindex\b(?=[^\w])/g, String(i))
            const resolvedTemplate = JSON.parse(templateStr)

            // Build a temporary data chain that includes $item / item
            const chainWithItem = { ...context.dataChain, $item: item, item }
            dataToCreate = interpolateVariables(resolvedTemplate, chainWithItem)
          } else {
            // No template — use the item directly (already interpolated above)
            dataToCreate = item
          }

          const record = await service[methodName](dataToCreate)
          results.push({ index: i, ok: true, record })
        } catch (e: any) {
          const error = e?.message || "Unknown error"
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
      return {
        success: false,
        error: error.message,
        errorStack: error.stack,
      }
    }
  },
}
