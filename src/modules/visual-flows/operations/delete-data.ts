import { z } from "zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

export const deleteDataOperation: OperationDefinition = {
  type: "delete_data",
  name: "Delete Data",
  description: "Delete records from a module",
  icon: "trash",
  category: "data",
  
  optionsSchema: z.object({
    module: z.string().describe("Module identifier"),
    collection: z.string().describe("Collection/entity name"),
    ids: z.array(z.string()).describe("IDs of records to delete"),
    soft_delete: z.boolean().default(true).describe("Use soft delete if available"),
  }),
  
  defaultOptions: {
    module: "",
    collection: "",
    ids: [],
    soft_delete: true,
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const moduleName = interpolateString(options.module, context.dataChain)
      const collection = interpolateString(options.collection, context.dataChain)
      const ids = interpolateVariables(options.ids, context.dataChain)
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          success: false,
          error: "No IDs provided for deletion",
        }
      }
      
      // Resolve the module service
      const service = context.container.resolve(moduleName) as any
      
      if (!service) {
        return {
          success: false,
          error: `Module '${moduleName}' not found`,
        }
      }
      
      // Try soft delete first if requested, fallback to hard delete
      const softDeleteMethod = `softDelete${capitalize(collection)}`
      const deleteMethod = `delete${capitalize(collection)}`
      
      let result: any
      
      if (options.soft_delete && typeof service[softDeleteMethod] === "function") {
        result = await service[softDeleteMethod](ids)
      } else if (typeof service[deleteMethod] === "function") {
        result = await service[deleteMethod](ids)
      } else {
        return {
          success: false,
          error: `Delete method not found on module '${moduleName}'`,
        }
      }
      
      return {
        success: true,
        data: {
          deleted_ids: ids,
          soft_deleted: options.soft_delete,
          result,
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

function capitalize(str: string): string {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}
