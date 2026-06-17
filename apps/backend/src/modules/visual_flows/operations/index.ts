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
export { aggregateDataOperation } from "./aggregate-data"
export { timeSeriesOperation } from "./time-series"
export { cartRecoveryStatsOperation } from "./cart-recovery-stats"
export { bulkUpdateDataOperation } from "./bulk-update-data"
export { bulkCreateDataOperation } from "./bulk-create-data"
export { bulkHttpRequestOperation } from "./bulk-http-request"
export { bulkTriggerWorkflowOperation } from "./bulk-trigger-workflow"
export { aiExtractOperation } from "./ai-extract"
export { aiExtractPlatformOperation } from "./ai-extract-platform"
export { generatePartnerDeeplinkOperation } from "./generate-partner-deeplink"
export { waitForEventOperation } from "./wait-for-event"

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
import { aggregateDataOperation } from "./aggregate-data"
import { timeSeriesOperation } from "./time-series"
import { cartRecoveryStatsOperation } from "./cart-recovery-stats"
import { bulkUpdateDataOperation } from "./bulk-update-data"
import { bulkCreateDataOperation } from "./bulk-create-data"
import { bulkHttpRequestOperation } from "./bulk-http-request"
import { bulkTriggerWorkflowOperation } from "./bulk-trigger-workflow"
import { aiExtractOperation } from "./ai-extract"
import { aiExtractPlatformOperation } from "./ai-extract-platform"
import { generatePartnerDeeplinkOperation } from "./generate-partner-deeplink"
import { waitForEventOperation } from "./wait-for-event"

// Register all built-in operations
export function registerBuiltInOperations(): void {
  // Logic operations
  operationRegistry.register(conditionOperation)
  operationRegistry.register(waitForEventOperation)
  
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
  operationRegistry.register(aiExtractPlatformOperation)
  
  // Utility operations
  operationRegistry.register(transformOperation)
  operationRegistry.register(logOperation)
  operationRegistry.register(sleepOperation)
  operationRegistry.register(executeCodeOperation)
  operationRegistry.register(generatePartnerDeeplinkOperation)

  // Analytics operations
  operationRegistry.register(aggregateProductAnalyticsOperation)
  operationRegistry.register(aggregateDataOperation)
  operationRegistry.register(timeSeriesOperation)
  operationRegistry.register(cartRecoveryStatsOperation)
}

// Auto-register on import
registerBuiltInOperations()
