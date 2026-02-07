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
      
      // Handle filters - interpolate values
      const filters = options.filters 
        ? interpolateVariables(options.filters, context.dataChain) 
        : undefined
      
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
