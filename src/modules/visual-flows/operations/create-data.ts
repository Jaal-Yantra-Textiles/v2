import { z } from "zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

export const createDataOperation: OperationDefinition = {
  type: "create_data",
  name: "Create Data",
  description: "Create a new record in a module",
  icon: "plus-circle",
  category: "data",
  
  optionsSchema: z.object({
    module: z.string().describe("Module identifier (e.g., 'person', 'designs')"),
    collection: z.string().describe("Collection/entity name (e.g., 'People', 'Designs')"),
    data: z.record(z.any()).describe("Data to create"),
  }),
  
  defaultOptions: {
    module: "",
    collection: "",
    data: {},
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const moduleName = interpolateString(options.module, context.dataChain)
      const collection = interpolateString(options.collection, context.dataChain)
      const data = interpolateVariables(options.data, context.dataChain)
      
      // Resolve the module service
      const service = context.container.resolve(moduleName) as any
      
      if (!service) {
        return {
          success: false,
          error: `Module '${moduleName}' not found`,
        }
      }
      
      // Build method name: create + PascalCase collection name
      // e.g., "People" -> "createPeople", "designs" -> "createDesigns"
      const methodName = `create${capitalize(collection)}`
      
      if (typeof service[methodName] !== "function") {
        return {
          success: false,
          error: `Method '${methodName}' not found on module '${moduleName}'`,
        }
      }
      
      const result = await service[methodName](data)
      
      return {
        success: true,
        data: result,
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

function capitalize(str: string): string {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}
