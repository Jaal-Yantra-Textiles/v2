import { z } from "zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

export const updateDataOperation: OperationDefinition = {
  type: "update_data",
  name: "Update Data",
  description: "Update existing records in a module",
  icon: "pencil-square",
  category: "data",
  
  optionsSchema: z.object({
    module: z.string().describe("Module identifier"),
    collection: z.string().describe("Collection/entity name"),
    selector: z.record(z.any()).describe("Selector to find records (e.g., { id: '...' })"),
    data: z.record(z.any()).describe("Data to update"),
  }),
  
  defaultOptions: {
    module: "",
    collection: "",
    selector: {},
    data: {},
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const moduleName = interpolateString(options.module, context.dataChain)
      const collection = interpolateString(options.collection, context.dataChain)
      const selector = interpolateVariables(options.selector, context.dataChain)
      const data = interpolateVariables(options.data, context.dataChain)
      
      // Resolve the module service
      const service = context.container.resolve(moduleName) as any
      
      if (!service) {
        return {
          success: false,
          error: `Module '${moduleName}' not found`,
        }
      }
      
      // Build method name: update + PascalCase collection name
      const methodName = `update${capitalize(collection)}`
      
      if (typeof service[methodName] !== "function") {
        return {
          success: false,
          error: `Method '${methodName}' not found on module '${moduleName}'`,
        }
      }
      
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
