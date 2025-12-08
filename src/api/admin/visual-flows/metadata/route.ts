import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { WorkflowManager } from "@medusajs/orchestration"

/**
 * GET /admin/visual-flows/metadata
 * 
 * Returns metadata about available entities, workflows, and services
 * that can be used in visual flows.
 * 
 * Dynamically introspects the Awilix container to discover registered modules.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    // Get all registered services from the Awilix container
    const registeredModules = getRegisteredModulesFromContainer(req.scope)
    
    // Get queryable entities (modules that can be used with query.graph)
    const entities = await getQueryableEntities(req.scope, registeredModules)
    
    // Get registered workflows
    const workflows = getRegisteredWorkflowsFromContainer(req.scope)
    
    // Get registered events from the Event Bus
    const events = getRegisteredEventsFromContainer(req.scope)
    
    // Get available flows that can be triggered by other flows
    const triggerableFlows = await getTriggerableFlows(req.scope)
    
    res.json({
      entities,
      workflows,
      // All registered module names for reference
      registeredModules: registeredModules.map(m => m.name),
      // Available Medusa events for event triggers (dynamically discovered)
      events,
      // Flows that can be triggered by other flows
      triggerableFlows,
      // Data chain special variables
      dataChainVariables: [
        { name: "$trigger", description: "Trigger payload data" },
        { name: "$last", description: "Output from the previous operation" },
        { name: "$input", description: "All data chain values" },
        { name: "$env", description: "Environment variables" },
      ],
      // Available interpolation syntax
      interpolationSyntax: {
        variable: "{{ variableName }}",
        nested: "{{ $last.records[0].id }}",
        expression: "{{ $last.count > 0 ? 'yes' : 'no' }}",
      },
    })
  } catch (error: any) {
    console.error("[visual-flows/metadata] Error:", error)
    res.status(500).json({ error: error.message })
  }
}

/**
 * Introspect the Awilix container to get all registered modules
 */
function getRegisteredModulesFromContainer(container: any): ModuleInfo[] {
  const modules: ModuleInfo[] = []
  
  // Get registrations from the container
  const registrations = container.registrations || {}
  
  // Framework/internal services to skip
  const skipServices = new Set([
    "__pg_connection__",
    "configModule",
    "featureFlagRouter", 
    "logger",
    "remoteQuery",
    "query",
    "link",
    "remoteLink",
    "cache",
    "event_bus",
    "workflows",
    "locking",
    "caching",
    "index",
  ])
  
  // Core Medusa modules (these are queryable with their entity names)
  const coreModules: Record<string, { entityName: string; description: string }> = {
    "product": { entityName: "products", description: "Product catalog" },
    "inventory": { entityName: "inventory_items", description: "Inventory items" },
    "stock_location": { entityName: "stock_locations", description: "Stock locations" },
    "pricing": { entityName: "prices", description: "Pricing" },
    "promotion": { entityName: "promotions", description: "Promotions & discounts" },
    "customer": { entityName: "customers", description: "Customer accounts" },
    "sales_channel": { entityName: "sales_channels", description: "Sales channels" },
    "cart": { entityName: "carts", description: "Shopping carts" },
    "region": { entityName: "regions", description: "Regions/Markets" },
    "api_key": { entityName: "api_keys", description: "API keys" },
    "store": { entityName: "stores", description: "Stores" },
    "tax": { entityName: "tax_rates", description: "Tax rates" },
    "currency": { entityName: "currencies", description: "Currencies" },
    "payment": { entityName: "payments", description: "Payments" },
    "order": { entityName: "orders", description: "Customer orders" },
    "auth": { entityName: "auth_identities", description: "Authentication" },
    "user": { entityName: "users", description: "Admin users" },
    "fulfillment": { entityName: "fulfillments", description: "Fulfillments" },
    "notification": { entityName: "notifications", description: "Notifications" },
    "file": { entityName: "files", description: "File storage" },
    "settings": { entityName: "settings", description: "Settings" },
  }
  
  // Iterate through all registrations
  for (const key of Object.keys(registrations)) {
    // Skip framework services
    if (skipServices.has(key)) {
      continue
    }
    
    // Check if it's a core Medusa module
    if (coreModules[key]) {
      modules.push({
        name: key,
        entityName: coreModules[key].entityName,
        type: "core",
        description: coreModules[key].description,
      })
      continue
    }
    
    // Everything else is a custom module
    // Convert module name to entity name (usually same or pluralized)
    const entityName = getEntityNameFromModule(key)
    
    modules.push({
      name: key,
      entityName,
      type: "custom",
      description: `Custom module: ${key.replace(/_/g, " ")}`,
    })
  }
  
  return modules
}

/**
 * Convert module registration name to queryable entity name
 */
function getEntityNameFromModule(moduleName: string): string {
  // Some modules have specific entity name mappings
  const entityMappings: Record<string, string> = {
    "person": "persons",
    "person_type": "person_types",
    "design": "designs",
    "partner": "partners",
    "tasks": "tasks",
    "notes": "notes",
    "agreements": "agreements",
    "media": "media",
    "feedback": "feedback",
    "socials": "socials",
    "social_provider": "social_providers",
    "email_templates": "email_templates",
    "raw_materials": "raw_materials",
    "companies": "companies",
    "websites": "websites",
    "inventory_orders": "inventory_orders",
    "internal_payments": "internal_payments",
    "fullfilled_orders": "fullfilled_orders",
    "custom_analytics": "custom_analytics",
    "etsysync": "etsysync",
    "external_stores": "external_stores",
    "encryption": "encryption",
    "visual_flows": "visual_flows",
    "s3_custom": "s3_custom",
  }
  
  return entityMappings[moduleName] || moduleName
}

/**
 * Get queryable entities from registered modules
 * Tests each entity to verify it can be queried via query.graph()
 * Also extracts available fields for filtering
 */
async function getQueryableEntities(container: any, modules: ModuleInfo[]): Promise<EntityMetadata[]> {
  const entities: EntityMetadata[] = []
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  
  // Process all modules and verify queryability
  for (const mod of modules) {
    let queryable = false
    let fields: FieldMetadata[] = []
    
    try {
      // Attempt a query to verify the entity is queryable and get sample data
      const result = await query.graph({
        entity: mod.entityName,
        fields: ["*"],
        pagination: { take: 1 },
      })
      queryable = true
      
      // Extract field names from the result
      if (result.data && result.data.length > 0) {
        const sampleRecord = result.data[0]
        fields = extractFieldsFromRecord(sampleRecord)
      }
    } catch {
      // Entity might not be queryable via graph - that's okay
      queryable = false
    }
    
    entities.push({
      name: mod.entityName,
      type: mod.type,
      description: mod.description,
      queryable,
      moduleName: mod.name,
      fields: fields.length > 0 ? fields : undefined,
    })
  }
  
  // Sort: queryable first, then by type (custom before core), then alphabetically
  entities.sort((a, b) => {
    if (a.queryable !== b.queryable) return a.queryable ? -1 : 1
    if (a.type !== b.type) return a.type === "custom" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  
  return entities
}

/**
 * Extract field metadata from a sample record
 */
function extractFieldsFromRecord(record: any): FieldMetadata[] {
  const fields: FieldMetadata[] = []
  
  for (const [key, value] of Object.entries(record)) {
    // Skip internal fields
    if (key.startsWith("__") || key === "raw_") continue
    
    // Determine field type from value
    const fieldType = getFieldType(value)
    
    // Determine if it's likely a filterable field
    const filterable = isFilterableField(key, fieldType)
    
    fields.push({
      name: key,
      type: fieldType,
      filterable,
    })
  }
  
  // Sort: id first, then filterable fields, then alphabetically
  fields.sort((a, b) => {
    if (a.name === "id") return -1
    if (b.name === "id") return 1
    if (a.filterable !== b.filterable) return a.filterable ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  
  return fields
}

/**
 * Determine field type from value
 */
function getFieldType(value: any): string {
  if (value === null || value === undefined) return "unknown"
  if (typeof value === "string") {
    // Check for date strings
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "datetime"
    // Check for UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return "id"
    return "string"
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number"
  }
  if (typeof value === "boolean") return "boolean"
  if (Array.isArray(value)) return "array"
  if (typeof value === "object") {
    if (value instanceof Date) return "datetime"
    return "object"
  }
  return "unknown"
}

/**
 * Determine if a field is likely filterable
 */
function isFilterableField(fieldName: string, fieldType: string): boolean {
  // Common filterable field patterns
  const filterablePatterns = [
    /^id$/,
    /_id$/,
    /^status$/,
    /^state$/,
    /^type$/,
    /^name$/,
    /^email$/,
    /^code$/,
    /^handle$/,
    /^slug$/,
    /^is_/,
    /^has_/,
    /_at$/,  // timestamps
    /^created/,
    /^updated/,
  ]
  
  // Non-filterable types
  if (fieldType === "object" || fieldType === "array" || fieldType === "unknown") {
    return false
  }
  
  return filterablePatterns.some(p => p.test(fieldName))
}

/**
 * Get all registered workflows from WorkflowManager
 * This uses the global WorkflowManager which stores all workflows created with createWorkflow()
 */
function getRegisteredWorkflowsFromContainer(container: any): WorkflowMetadata[] {
  const workflows: WorkflowMetadata[] = []
  
  // Get all workflows from the global WorkflowManager
  const registeredWorkflows = WorkflowManager.getWorkflows()
  
  for (const [workflowId, workflowDef] of registeredWorkflows.entries()) {
    // Extract workflow info
    const name = workflowId
    
    // Categorize based on workflow name
    const category = categorizeWorkflow(name)
    
    // Get step information from the workflow definition
    const steps = extractWorkflowSteps(workflowDef)
    
    // Get required/optional modules
    const requiredModules: string[] = workflowDef.requiredModules 
      ? Array.from(workflowDef.requiredModules) as string[]
      : []
    const optionalModules: string[] = workflowDef.optionalModules 
      ? Array.from(workflowDef.optionalModules) as string[]
      : []
    
    workflows.push({
      name,
      description: `Workflow: ${name.replace(/-/g, " ")}`,
      category,
      steps,
      requiredModules,
      optionalModules,
      isScheduled: !!workflowDef.options?.schedule,
    })
  }
  
  // Sort by category then name
  workflows.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.name.localeCompare(b.name)
  })
  
  return workflows
}

/**
 * Categorize workflow based on its name
 */
function categorizeWorkflow(name: string): string {
  const lowerName = name.toLowerCase()
  
  if (lowerName.includes("design")) return "designs"
  if (lowerName.includes("order")) return "orders"
  if (lowerName.includes("task")) return "tasks"
  if (lowerName.includes("agreement")) return "agreements"
  if (lowerName.includes("partner")) return "partners"
  if (lowerName.includes("payment")) return "payments"
  if (lowerName.includes("fulfillment")) return "fulfillment"
  if (lowerName.includes("notification") || lowerName.includes("email")) return "notifications"
  if (lowerName.includes("visual") || lowerName.includes("flow")) return "visual-flows"
  if (lowerName.includes("product")) return "products"
  if (lowerName.includes("inventory")) return "inventory"
  if (lowerName.includes("customer")) return "customers"
  if (lowerName.includes("cart")) return "cart"
  if (lowerName.includes("person")) return "persons"
  if (lowerName.includes("social")) return "socials"
  if (lowerName.includes("analytics")) return "analytics"
  if (lowerName.includes("blog")) return "blogs"
  if (lowerName.includes("ai") || lowerName.includes("llm") || lowerName.includes("extract")) return "ai"
  
  return "general"
}

/**
 * Extract step names from workflow definition
 */
function extractWorkflowSteps(workflowDef: any): string[] {
  const steps: string[] = []
  
  try {
    // The flow_ contains the step definitions
    if (workflowDef.flow_) {
      extractStepsFromFlow(workflowDef.flow_, steps)
    }
    
    // Also get from handlers_ map
    if (workflowDef.handlers_) {
      for (const [stepId] of workflowDef.handlers_.entries()) {
        if (!steps.includes(stepId)) {
          steps.push(stepId)
        }
      }
    }
  } catch {
    // Ignore errors in step extraction
  }
  
  return steps
}

/**
 * Recursively extract step names from flow definition
 */
function extractStepsFromFlow(flow: any, steps: string[]): void {
  if (!flow) return
  
  // Check for action property (step name)
  if (flow.action && typeof flow.action === "string") {
    if (!steps.includes(flow.action)) {
      steps.push(flow.action)
    }
  }
  
  // Check for nested steps
  if (flow.next) {
    if (Array.isArray(flow.next)) {
      for (const nextStep of flow.next) {
        extractStepsFromFlow(nextStep, steps)
      }
    } else {
      extractStepsFromFlow(flow.next, steps)
    }
  }
  
  // Check for parallel steps
  if (flow.steps && Array.isArray(flow.steps)) {
    for (const step of flow.steps) {
      extractStepsFromFlow(step, steps)
    }
  }
}

// Helper functions
function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/__+/g, "_")
}

function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "")
    .replace(/--+/g, "-")
}

function isFrameworkService(name: string): boolean {
  const frameworkPatterns = [
    /^__/,
    /^config/i,
    /^logger/i,
    /^manager/i,
    /^featureFlag/i,
    /^remoteQuery/i,
    /^link/i,
    /^pg/i,
    /^redis/i,
    /^eventBus/i,
  ]
  return frameworkPatterns.some(p => p.test(name))
}

interface ModuleInfo {
  name: string
  entityName: string
  type: "core" | "custom"
  description: string
}

interface EntityMetadata {
  name: string
  type: "core" | "custom"
  description: string
  queryable: boolean
  moduleName?: string // The container registration name
  fields?: FieldMetadata[]
}

interface FieldMetadata {
  name: string
  type: string
  required?: boolean
  filterable?: boolean
}

interface WorkflowMetadata {
  name: string
  description: string
  category: string
  steps?: string[]
  requiredModules?: string[]
  optionalModules?: string[]
  isScheduled?: boolean
  inputSchema?: Record<string, any>
}

interface EventMetadata {
  name: string
  description: string
  category: string
  payload?: string[]
  subscriberCount?: number
}

/**
 * Get registered events from the Event Bus service
 * Dynamically discovers all events that have subscribers registered
 */
function getRegisteredEventsFromContainer(container: any): EventMetadata[] {
  const events: EventMetadata[] = []
  
  try {
    // Get the Event Bus service
    const eventBusService = container.resolve(Modules.EVENT_BUS) as any
    
    if (!eventBusService) {
      console.log("[metadata] Event Bus service not found, returning fallback events")
      return getFallbackEvents()
    }
    // Access the eventToSubscribersMap_ which contains all registered events
    const eventMap = eventBusService.eventToSubscribersMap_ as Map<string, any[]> | undefined
    
    if (!eventMap || eventMap.size === 0) {
      console.log("[metadata] No events found in Event Bus, returning fallback events")
      return getFallbackEvents()
    }
    
    // Convert the map to our EventMetadata format
    for (const [eventName, subscribers] of eventMap.entries()) {
      // Skip internal/system events
      if (eventName.startsWith("index.") || eventName.startsWith("Link")) {
        continue
      }
      
      // Categorize the event based on its name
      const category = categorizeEvent(eventName)
      const description = generateEventDescription(eventName)
      
      events.push({
        name: eventName,
        description,
        category,
        subscriberCount: subscribers?.length || 0,
      })
    }
    
    // Sort events by category and name
    events.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category)
      }
      return a.name.localeCompare(b.name)
    })
    
    console.log(`[metadata] Found ${events.length} registered events from Event Bus`)
    return events
    
  } catch (error: any) {
    console.error("[metadata] Error getting events from Event Bus:", error.message)
    return getFallbackEvents()
  }
}

/**
 * Categorize an event based on its name
 */
function categorizeEvent(eventName: string): string {
  const lowerName = eventName.toLowerCase()
  
  // Check for module prefixes (e.g., "product.product.created")
  if (lowerName.startsWith("order.") || lowerName.includes("order")) return "orders"
  if (lowerName.startsWith("product.") || lowerName.includes("product")) return "products"
  if (lowerName.startsWith("customer.") || lowerName.includes("customer")) return "customers"
  if (lowerName.startsWith("cart.") || lowerName.includes("cart")) return "cart"
  if (lowerName.startsWith("inventory") || lowerName.includes("inventory")) return "inventory"
  if (lowerName.startsWith("fulfillment.") || lowerName.includes("fulfillment")) return "fulfillment"
  if (lowerName.startsWith("shipment.") || lowerName.includes("shipment")) return "fulfillment"
  if (lowerName.startsWith("delivery.") || lowerName.includes("delivery")) return "fulfillment"
  if (lowerName.startsWith("payment.") || lowerName.includes("payment")) return "payments"
  if (lowerName.startsWith("pricing.") || lowerName.includes("price")) return "pricing"
  if (lowerName.startsWith("sales_channel.") || lowerName.includes("sales_channel")) return "sales_channels"
  if (lowerName.startsWith("auth.") || lowerName.includes("password")) return "auth"
  if (lowerName.startsWith("partner.") || lowerName.includes("partner")) return "partners"
  if (lowerName.startsWith("person.") || lowerName.includes("person")) return "persons"
  if (lowerName.startsWith("task") || lowerName.includes("task")) return "tasks"
  if (lowerName.startsWith("design") || lowerName.includes("design")) return "designs"
  if (lowerName.startsWith("agreement") || lowerName.includes("agreement")) return "agreements"
  if (lowerName.startsWith("social") || lowerName.includes("social")) return "social"
  if (lowerName.startsWith("analytics") || lowerName.includes("analytics")) return "analytics"
  if (lowerName.startsWith("page.") || lowerName.includes("page")) return "pages"
  if (lowerName.startsWith("feedback") || lowerName.includes("feedback")) return "feedback"
  if (lowerName.startsWith("subscription") || lowerName.includes("subscription")) return "subscriptions"
  
  return "other"
}

/**
 * Generate a human-readable description for an event
 */
function generateEventDescription(eventName: string): string {
  // Handle common patterns
  const parts = eventName.split(".")
  
  // Pattern: module.entity.action (e.g., "product.product.created")
  if (parts.length === 3) {
    const [module, entity, action] = parts
    const entityName = entity.replace(/-/g, " ")
    return `When a ${entityName} is ${action}`
  }
  
  // Pattern: entity.action (e.g., "order.placed")
  if (parts.length === 2) {
    const [entity, action] = parts
    const entityName = entity.replace(/-/g, " ").replace(/_/g, " ")
    return `When ${entityName} ${action.replace(/_/g, " ")}`
  }
  
  // Single word events (e.g., "task_assigned")
  return `Event: ${eventName.replace(/_/g, " ").replace(/\./g, " ")}`
}

/**
 * Fallback events list if Event Bus is not available
 */
function getFallbackEvents(): EventMetadata[] {
  return [
    // Order events
    { name: "order.placed", description: "When a new order is placed", category: "orders" },
    { name: "order.created", description: "When an order is created", category: "orders" },
    { name: "order.fulfillment_created", description: "When fulfillment is created", category: "orders" },
    
    // Product events
    { name: "product.product.created", description: "When a product is created", category: "products" },
    { name: "product.product.updated", description: "When a product is updated", category: "products" },
    { name: "product.product.deleted", description: "When a product is deleted", category: "products" },
    
    // Auth events
    { name: "auth.password_reset", description: "When password reset is requested", category: "auth" },
    
    // Custom events
    { name: "partner.created.fromAdmin", description: "When partner is created from admin", category: "partners" },
    { name: "task_assigned", description: "When a task is assigned", category: "tasks" },
    { name: "analytics_event.created", description: "When analytics event is recorded", category: "analytics" },
    { name: "page.created", description: "When a page is created", category: "pages" },
  ]
}

interface TriggerableFlow {
  id: string
  name: string
  description?: string
  trigger_type: string
  status: string
}

/**
 * Get flows that can be triggered by other flows
 * Returns flows with trigger_type "another_flow" or "manual" that are active
 */
async function getTriggerableFlows(container: any): Promise<TriggerableFlow[]> {
  try {
    // Try to resolve the visual flows module
    const visualFlowsModule = container.resolve("visual_flows") as any
    
    if (!visualFlowsModule) {
      console.log("[metadata] Visual Flows module not found")
      return []
    }
    
    // Get all flows that can be triggered
    const flows = await visualFlowsModule.listVisualFlows({
      trigger_type: ["another_flow", "manual"],
    })
    
    // Filter to only active flows and map to simple format
    const triggerableFlows: TriggerableFlow[] = flows
      .filter((flow: any) => flow.status === "active" || flow.status === "draft")
      .map((flow: any) => ({
        id: flow.id,
        name: flow.name,
        description: flow.description,
        trigger_type: flow.trigger_type,
        status: flow.status,
      }))
    
    console.log(`[metadata] Found ${triggerableFlows.length} triggerable flows`)
    return triggerableFlows
    
  } catch (error: any) {
    console.error("[metadata] Error getting triggerable flows:", error.message)
    return []
  }
}
