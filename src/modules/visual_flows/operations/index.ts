// Types and utilities
export * from "./types"
export * from "./utils"

// Operations
export { conditionOperation } from "./condition"
export { transformOperation } from "./transform"
export { httpRequestOperation } from "./http-request"
export { logOperation } from "./log"
export { sleepOperation } from "./sleep"
export { notificationOperation } from "./notification"
export { triggerWorkflowOperation } from "./trigger-workflow"
export { triggerFlowOperation } from "./trigger-flow"
export { createDataOperation } from "./create-data"
export { readDataOperation } from "./read-data"
export { updateDataOperation } from "./update-data"
export { deleteDataOperation } from "./delete-data"
export { sendEmailOperation } from "./send-email"
export { sendWhatsAppOperation } from "./send-whatsapp"
export { executeCodeOperation } from "./execute-code"
export { aggregateProductAnalyticsOperation } from "./aggregate-product-analytics"
export { bulkUpdateDataOperation } from "./bulk-update-data"
export { bulkCreateDataOperation } from "./bulk-create-data"
export { bulkHttpRequestOperation } from "./bulk-http-request"
export { bulkTriggerWorkflowOperation } from "./bulk-trigger-workflow"
export { aiExtractOperation } from "./ai-extract"

// Import all operations and register them
import { operationRegistry } from "./types"
import { conditionOperation } from "./condition"
import { transformOperation } from "./transform"
import { httpRequestOperation } from "./http-request"
import { logOperation } from "./log"
import { sleepOperation } from "./sleep"
import { notificationOperation } from "./notification"
import { triggerWorkflowOperation } from "./trigger-workflow"
import { triggerFlowOperation } from "./trigger-flow"
import { createDataOperation } from "./create-data"
import { readDataOperation } from "./read-data"
import { updateDataOperation } from "./update-data"
import { deleteDataOperation } from "./delete-data"
import { sendEmailOperation } from "./send-email"
import { sendWhatsAppOperation } from "./send-whatsapp"
import { executeCodeOperation } from "./execute-code"
import { aggregateProductAnalyticsOperation } from "./aggregate-product-analytics"
import { bulkUpdateDataOperation } from "./bulk-update-data"
import { bulkCreateDataOperation } from "./bulk-create-data"
import { bulkHttpRequestOperation } from "./bulk-http-request"
import { bulkTriggerWorkflowOperation } from "./bulk-trigger-workflow"
import { aiExtractOperation } from "./ai-extract"

// Register all built-in operations
export function registerBuiltInOperations(): void {
  // Logic operations
  operationRegistry.register(conditionOperation)
  
  // Data operations
  operationRegistry.register(createDataOperation)
  operationRegistry.register(readDataOperation)
  operationRegistry.register(updateDataOperation)
  operationRegistry.register(deleteDataOperation)
  operationRegistry.register(bulkUpdateDataOperation)
  operationRegistry.register(bulkCreateDataOperation)
  operationRegistry.register(bulkHttpRequestOperation)
  operationRegistry.register(bulkTriggerWorkflowOperation)
  
  // Communication operations
  operationRegistry.register(sendEmailOperation)
  operationRegistry.register(sendWhatsAppOperation)
  operationRegistry.register(notificationOperation)
  
  // Integration operations
  operationRegistry.register(httpRequestOperation)
  operationRegistry.register(triggerWorkflowOperation)
  operationRegistry.register(triggerFlowOperation)
  operationRegistry.register(aiExtractOperation)
  
  // Utility operations
  operationRegistry.register(transformOperation)
  operationRegistry.register(logOperation)
  operationRegistry.register(sleepOperation)
  operationRegistry.register(executeCodeOperation)

  // Analytics operations
  operationRegistry.register(aggregateProductAnalyticsOperation)
}

// Auto-register on import
registerBuiltInOperations()
