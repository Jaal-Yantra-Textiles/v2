import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const readDataOperation: OperationDefinition = {
  type: "read_data",
  name: "Read Data",
  description: "Query data from a module using query.graph",
  icon: "magnifying-glass",
  category: "data",
  
  optionsSchema: z.object({
    entity: z.string().describe("Entity name to query"),
    fields: z.array(z.string()).describe("Fields to retrieve"),
    filters: z.record(z.any()).optional().describe("Filter conditions"),
    limit: z.number().optional().describe("Maximum number of records"),
    offset: z.number().optional().describe("Number of records to skip"),
  }),
  
  defaultOptions: {
    entity: "",
    fields: ["*"],
    filters: {},
    limit: 100,
    offset: 0,
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const entity = interpolateString(options.entity, context.dataChain)
      
      // Handle fields - use ["*"] if empty or not provided
      let fields = ["*"]
      if (options.fields && Array.isArray(options.fields) && options.fields.length > 0) {
        fields = options.fields.map((f: string) => interpolateString(f, context.dataChain))
      }
      
      // Handle filters - interpolate values. If the source had filter keys
      // but any of them resolved to undefined/null/"", short-circuit with an
      // empty result instead of dropping the key and returning arbitrary
      // rows. The previous "warn-and-drop" behavior turned a missing
      // partner_id into a wrong-partner read (and downstream
      // misdelivery). Refusing to query is the safe default; bad variable
      // paths surface as zero records + an error message instead of silent
      // misuse of the first row.
      const rawFilters = options.filters
        ? interpolateVariables(options.filters, context.dataChain)
        : undefined

      const filters: Record<string, any> = {}
      const unresolvedFilterKeys: string[] = []
      if (rawFilters && typeof rawFilters === "object") {
        for (const [k, v] of Object.entries(rawFilters)) {
          if (v === undefined || v === null || v === "") {
            unresolvedFilterKeys.push(k)
          } else {
            filters[k] = v
          }
        }
      }

      if (unresolvedFilterKeys.length > 0) {
        const msg = `Filter key(s) ${JSON.stringify(unresolvedFilterKeys)} resolved to null/undefined — refusing to query without them to avoid returning arbitrary rows. Check the variable paths in your filters.`
        console.warn(`[read_data] ${msg}`)
        return {
          success: true,
          data: {
            records: [],
            count: 0,
            unresolved_filter_keys: unresolvedFilterKeys,
            warning: msg,
          },
        }
      }

      if (!entity) {
        return {
          success: false,
          error: "Entity name is required for read_data operation",
        }
      }
      
      console.log(`[read_data] Querying entity: ${entity}, fields:`, fields, "filters:", filters)
      
      // Use query.graph for data retrieval
      const query = context.container.resolve(ContainerRegistrationKeys.QUERY)
      
      const queryOptions: any = {
        entity,
        fields,
      }
      
      if (filters && Object.keys(filters).length > 0) {
        queryOptions.filters = filters
      }
      
      if (options.limit) {
        queryOptions.pagination = {
          take: options.limit,
          skip: options.offset || 0,
        }
      }
      
      console.log(`[read_data] Query options:`, JSON.stringify(queryOptions))
      
      const result = await query.graph(queryOptions)
      
      console.log(`[read_data] Query returned ${result.data?.length || 0} records`)
      
      return {
        success: true,
        data: {
          records: result.data || [],
          count: result.data?.length || 0,
        },
      }
    } catch (error: any) {
      console.error(`[read_data] Error:`, error.message)
      return {
        success: false,
        error: error.message,
        errorStack: error.stack,
      }
    }
  },
}
