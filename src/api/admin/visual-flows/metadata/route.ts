/**
 * Visual Flows Metadata API
 *
 * This API endpoint provides comprehensive metadata about the Medusa e-commerce platform
 * that can be used to build visual workflow automation flows.
 *
 * The metadata includes:
 * - Available entities (database models) that can be queried
 * - Registered workflows and their steps
 * - System events that can trigger flows
 * - Other flows that can be triggered
 * - Data chain variables for expression interpolation
 *
 * Example Usage:
 *
 * 1. Get all metadata:
 *    GET /admin/visual-flows/metadata
 *
 * 2. Use metadata to build a flow:
 *    - Find queryable entities to use as data sources
 *    - Discover available workflows to execute
 *    - Identify events to trigger flows
 *    - Reference other flows that can be triggered
 *
 * 3. Data chain variables in expressions:
 *    - "{{ $trigger.user_id }}" - Access trigger payload
 *    - "{{ $last.records[0].id }}" - Access previous operation output
 *    - "{{ $input.customer_name }}" - Access any data chain value
 *    - "{{ $env.API_KEY }}" - Access environment variables
 *
 * 4. Conditional expressions:
 *    - "{{ $last.count > 0 ? 'yes' : 'no' }}"
 *    - "{{ $trigger.status === 'completed' }}"
 *
 * Response Structure:
 * {
 *   entities: EntityMetadata[] - All available entities with query capabilities
 *   workflows: WorkflowMetadata[] - All registered workflows
 *   registeredModules: string[] - All module names
 *   events: EventMetadata[] - All system events
 *   triggerableFlows: TriggerableFlow[] - Flows that can be triggered
 *   dataChainVariables: { name: string, description: string }[] - Special variables
 *   interpolationSyntax: { variable: string, nested: string, expression: string } - Syntax examples
 * }
 *
 * EntityMetadata:
 * {
 *   name: string - Entity name (e.g., "products")
 *   type: "core" | "custom" - Module type
 *   description: string - Human-readable description
 *   queryable: boolean - Can be queried via query.graph
 *   queryError?: string - Error if not queryable
 *   moduleName?: string - Container registration name
 *   fields?: FieldMetadata[] - Available fields for filtering
 * }
 *
 * FieldMetadata:
 * {
 *   name: string - Field name
 *   type: string - Field type (string, number, boolean, etc.)
 *   filterable?: boolean - Can be used in filters
 * }
 *
 * WorkflowMetadata:
 * {
 *   name: string - Workflow name
 *   description: string - Human-readable description
 *   category: string - Workflow category
 *   steps?: string[] - Step names
 *   requiredModules?: string[] - Required modules
 *   optionalModules?: string[] - Optional modules
 *   isScheduled?: boolean - Is scheduled workflow
 * }
 *
 * EventMetadata:
 * {
 *   name: string - Event name
 *   description: string - Human-readable description
 *   category: string - Event category
 *   subscriberCount?: number - Number of subscribers
 * }
 *
 * TriggerableFlow:
 * {
 *   id: string - Flow ID
 *   name: string - Flow name
 *   description?: string - Flow description
 *   trigger_type: string - Trigger type
 *   status: string - Flow status
 * }
 *
 * Debugging:
 * Set VISUAL_FLOWS_METADATA_DEBUG=true environment variable to enable detailed logging
 * of module discovery, entity query testing, and workflow extraction.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { WorkflowManager } from "@medusajs/orchestration"
import { DmlEntity, camelToSnakeCase, pluralize } from "@medusajs/utils"
import * as fs from "fs"
import * as path from "path"

// ── Input schema types ────────────────────────────────────────────────────────

export interface WorkflowInputField {
  name: string
  type: "string" | "number" | "boolean" | "date" | "array" | "object" | "id"
  description?: string
  required?: boolean
  placeholder?: string
  example?: any
}

// ── Pre-generated schema cache (workflow-schemas.json) ───────────────────────

interface GeneratedSchemaEntry {
  fields: WorkflowInputField[]
  source: "custom_ts" | "core_dts" | "inferred"
  sourceFile?: string
}

let _generatedSchemas: Record<string, GeneratedSchemaEntry> | null = null

function getGeneratedSchemas(): Record<string, GeneratedSchemaEntry> {
  if (_generatedSchemas !== null) return _generatedSchemas

  const candidates = [
    path.join(process.cwd(), "workflow-schemas.json"),
    path.resolve(__dirname, "..", "..", "..", "..", "..", "workflow-schemas.json"),
    path.resolve(__dirname, "..", "..", "..", "..", "workflow-schemas.json"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        _generatedSchemas = JSON.parse(fs.readFileSync(candidate, "utf-8"))
        return _generatedSchemas!
      } catch { /* corrupt JSON, keep looking */ }
    }
  }

  _generatedSchemas = {} // nothing found
  return _generatedSchemas
}

// ── Source-file scanner ───────────────────────────────────────────────────────

/**
 * Cached map of workflow-name → absolute source file path.
 * Built once per process from src/workflows/**‌/*.ts.
 */
let _workflowFileCache: Map<string, string> | null = null

function getWorkflowFileMap(): Map<string, string> {
  if (_workflowFileCache) return _workflowFileCache
  const map = new Map<string, string>()

  // 1. Custom workflows: scan src/workflows/**/*.ts
  const srcCandidates = [
    path.join(process.cwd(), "src", "workflows"),
    path.resolve(__dirname, "..", "..", "..", "..", "workflows"),
  ]
  for (const dir of srcCandidates) {
    if (fs.existsSync(dir)) {
      scanDirForWorkflows(dir, map, ".ts")
      if (map.size > 0) break
    }
  }

  // 2. Core Medusa workflows: scan @medusajs/core-flows/dist/**/*.js for workflow IDs
  //    then map each ID to the corresponding .d.ts in @medusajs/types/dist/workflow/
  const coreFlowsDir = resolveNodeModuleDir("@medusajs/core-flows", "dist")
  const typesWorkflowDir = resolveNodeModuleDir("@medusajs/types", path.join("dist", "workflow"))

  if (coreFlowsDir && typesWorkflowDir) {
    const idToTypeFile = buildCoreFlowsTypeFileMap(coreFlowsDir, typesWorkflowDir)
    for (const [id, typeFile] of idToTypeFile) {
      if (!map.has(id)) map.set(id, typeFile)
    }
  }

  _workflowFileCache = map
  return map
}

/** Try to resolve a node_modules path, returning null if not found */
function resolveNodeModuleDir(pkg: string, subDir: string): string | null {
  const candidates = [
    path.join(process.cwd(), "node_modules", pkg, subDir),
    path.resolve(__dirname, "..", "..", "..", "..", "..", "node_modules", pkg, subDir),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

/**
 * Scan core-flows .js files for `WorkflowId = "..."` constants,
 * then map each workflow ID to the matching .d.ts in @medusajs/types/dist/workflow/.
 */
function buildCoreFlowsTypeFileMap(coreFlowsDir: string, typesWorkflowDir: string): Map<string, string> {
  const result = new Map<string, string>()

  // Build a slug → .d.ts path map from the types package
  // e.g. "cancel-order" → "order/cancel-order.d.ts"
  const slugToTypeFile = new Map<string, string>()
  scanDirForDts(typesWorkflowDir, typesWorkflowDir, slugToTypeFile)

  // Scan core-flows .js for WorkflowId constants
  const idPattern = /WorkflowId\s*=\s*["']([^"']+)["']/g
  scanDirForWorkflowIds(coreFlowsDir, idPattern, slugToTypeFile, result)

  return result
}

function scanDirForDts(baseDir: string, dir: string, slugToFile: Map<string, string>) {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scanDirForDts(baseDir, full, slugToFile)
    } else if (entry.name.endsWith(".d.ts") && !entry.name.endsWith(".d.ts.map")) {
      const slug = entry.name.replace(".d.ts", "")
      if (!slugToFile.has(slug)) slugToFile.set(slug, full)
    }
  }
}

function scanDirForWorkflowIds(
  dir: string,
  pattern: RegExp,
  slugToTypeFile: Map<string, string>,
  result: Map<string, string>
) {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scanDirForWorkflowIds(full, pattern, slugToTypeFile, result)
    } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".js.map")) {
      try {
        const content = fs.readFileSync(full, "utf-8")
        pattern.lastIndex = 0
        for (const m of content.matchAll(pattern)) {
          const workflowId = m[1] // e.g. "cancel-order"
          if (result.has(workflowId)) continue
          // Try to find a matching .d.ts by slug (last segment of the id)
          const slug = workflowId.split("-").slice(-2).join("-") // "cancel-order"
          const typeFile = slugToTypeFile.get(workflowId)
            ?? slugToTypeFile.get(slug)
            ?? slugToTypeFile.get(workflowId.replace(/-workflow$/, ""))
          if (typeFile) result.set(workflowId, typeFile)
        }
      } catch { /* skip */ }
    }
  }
}

function scanDirForWorkflows(dir: string, map: Map<string, string>, ext: string) {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scanDirForWorkflows(full, map, ext)
    } else if (entry.name.endsWith(ext)) {
      try {
        const content = fs.readFileSync(full, "utf-8")
        for (const m of content.matchAll(/createWorkflow\(\s*["']([^"']+)["']/g)) {
          if (!map.has(m[1])) map.set(m[1], full)
        }
      } catch { /* skip unreadable files */ }
    }
  }
}

/**
 * Map a TypeScript type string + field name → our field type enum.
 */
function mapTsType(name: string, tsType: string): WorkflowInputField["type"] {
  if (name === "id" || name.endsWith("_id")) return "id"
  const t = tsType.toLowerCase().replace(/\s+/g, "")
  if (t === "date" || name.endsWith("_at") || name.endsWith("_date") || name.includes("date")) return "date"
  if (t === "number" || t === "int" || t === "float") return "number"
  if (t === "boolean" || t === "bool") return "boolean"
  if (t.endsWith("[]") || t.startsWith("array<") || t.startsWith("arraylike")) return "array"
  if (t.startsWith("record<") || t.startsWith("{") || t.startsWith("object")) return "object"
  // union of string literals / enum → string
  if (t.startsWith("'") || t.startsWith('"')) return "string"
  if (t.includes("|")) return "string"
  return "string"
}

function defaultPlaceholder(name: string, type: WorkflowInputField["type"]): string {
  if (name === "id" || name.endsWith("_id")) return `{{ $last.${name} }}`
  if (type === "date") return `{{ $trigger.${name} }}`
  if (type === "array") return `{{ $last.${name} }}`
  if (type === "object") return "{}"
  if (type === "number") return "0"
  if (type === "boolean") return "false"
  return `{{ $last.${name} }}`
}

/**
 * Extract workflow input fields from a TypeScript source file.
 * Finds the first type/interface whose name contains "Input" and parses its top-level fields.
 */
function extractInputFieldsFromSource(source: string): WorkflowInputField[] {
  // Match: type FooInput = { ... } or interface FooInput { ... }
  // We need to handle the body carefully because of nested braces.
  const headerRe = /(?:type|interface)\s+\w*[Ii]nput\w*\s*(?:=\s*)?\{/g
  const headerMatch = headerRe.exec(source)
  if (!headerMatch) return []

  // Find matching closing brace
  let depth = 0
  let start = -1
  let end = -1
  for (let i = headerMatch.index; i < source.length; i++) {
    if (source[i] === "{") { if (depth === 0) start = i; depth++ }
    else if (source[i] === "}") { depth--; if (depth === 0) { end = i; break } }
  }
  if (start === -1 || end === -1) return []

  const body = source.slice(start + 1, end)
  const fields: WorkflowInputField[] = []

  // Parse top-level field lines (skip nested object bodies)
  let nestDepth = 0
  for (const line of body.split("\n")) {
    // Track nested brace depth to skip nested object fields
    for (const ch of line) {
      if (ch === "{") nestDepth++
      else if (ch === "}") nestDepth--
    }
    if (nestDepth !== 0) continue

    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue

    // Field pattern: fieldName?: SomeType; or fieldName: SomeType;
    const m = trimmed.match(/^(\w+)(\?)?\s*:\s*(.+?)(?:;)?\s*$/)
    if (!m) continue

    const [, name, optional] = m
    if (!name || name === "type") continue // skip "type" keyword confusion

    // Strip trailing inline comment and semicolons from the type
    let rt = m[3].replace(/\s*\/\/.*$/, "").replace(/\s*;$/, "").trim()

    // Skip if rawType is just an opening brace (multi-line nested object)
    if (rt === "{" || rt === "(" || rt === "") continue

    const fieldType = mapTsType(name, rt)
    fields.push({
      name,
      type: fieldType,
      required: !optional,
      placeholder: defaultPlaceholder(name, fieldType),
    })
  }

  return fields
}

function getInputFieldsFromSourceFile(workflowName: string): WorkflowInputField[] {
  const fileMap = getWorkflowFileMap()
  const filePath = fileMap.get(workflowName)
  if (!filePath) return []
  try {
    const source = fs.readFileSync(filePath, "utf-8")
    const fields = extractInputFieldsFromSource(source)
    // For .d.ts files, also try to extract JSDoc descriptions
    if (filePath.endsWith(".d.ts")) {
      return enrichWithJsDocDescriptions(source, fields)
    }
    return fields
  } catch { return [] }
}

/**
 * For .d.ts files, try to find the JSDoc comment above each field
 * and use it as the field description.
 */
function enrichWithJsDocDescriptions(source: string, fields: WorkflowInputField[]): WorkflowInputField[] {
  return fields.map(field => {
    // Look for the JSDoc block immediately before `fieldName?:` or `fieldName:`
    const re = new RegExp(`\\/\\*\\*([\\s\\S]*?)\\*\\/\\s*\\n\\s*${field.name}\\??\\s*:`)
    const m = source.match(re)
    if (m) {
      // Extract text from JSDoc: strip leading " * " markers
      const desc = m[1]
        .split("\n")
        .map(l => l.replace(/^\s*\*\s?/, "").trim())
        .filter(Boolean)
        .join(" ")
      return { ...field, description: desc }
    }
    return field
  })
}

// ── Static overrides (enrich auto-extracted fields with better descriptions/placeholders) ──

/**
 * Static input schema registry.
 * Keys are workflow IDs (as registered with createWorkflow).
 * These OVERRIDE auto-extracted schemas — use when you need better descriptions or placeholders.
 * Auto-extraction from source files handles everything else automatically.
 */
const WORKFLOW_INPUT_SCHEMAS: Record<string, WorkflowInputField[]> = {
  // ── Inventory Orders ───────────────────────────────────────────────────────
  "create-inventory-order-workflow": [
    { name: "quantity",               type: "number",  required: true,  description: "Total unit count", placeholder: "{{ extracted.total_quantity }}" },
    { name: "total_price",            type: "number",  required: true,  description: "Total order price", placeholder: "{{ extracted.total }}" },
    { name: "status",                 type: "string",  required: true,  description: "Pending | Processing | Shipped | Delivered | Cancelled", placeholder: "Pending" },
    { name: "stock_location_id",      type: "id",      required: true,  description: "Destination stock location ID", placeholder: "sloc_..." },
    { name: "order_date",             type: "date",    required: false, description: "ISO date string", placeholder: "{{ $trigger.received_at }}" },
    { name: "expected_delivery_date", type: "date",    required: false, description: "ISO date string", placeholder: "{{ extracted.estimated_delivery }}" },
    { name: "order_lines",            type: "array",   required: true,  description: "Array of { inventory_item_id, quantity, price }", placeholder: "{{ item_mappings.order_lines }}" },
    { name: "metadata",               type: "object",  required: false, description: "Arbitrary key/value metadata", placeholder: '{ "order_number": "{{ extracted.order_number }}" }' },
  ],
  "update-inventory-order-workflow": [
    { name: "id",       type: "id",     required: true,  description: "Inventory order ID", placeholder: "{{ $last.id }}" },
    { name: "status",   type: "string", required: false, description: "Pending | Processing | Shipped | Delivered | Cancelled", placeholder: "Shipped" },
    { name: "metadata", type: "object", required: false, description: "Fields to merge into metadata", placeholder: '{ "key": "value" }' },
  ],
  "delete-inventory-order-workflow": [
    { name: "id", type: "id", required: true, description: "Inventory order ID to delete", placeholder: "{{ $last.id }}" },
  ],
  "send-inventory-order-to-partner": [
    { name: "id", type: "id", required: true, description: "Inventory order ID", placeholder: "{{ $last.id }}" },
  ],
  "partner-complete-inventory-order": [
    { name: "id", type: "id", required: true, description: "Inventory order ID", placeholder: "{{ $last.id }}" },
  ],
  // ── Notifications ──────────────────────────────────────────────────────────
  "send-notification": [
    { name: "to",       type: "string", required: true,  description: "Recipient email or phone", placeholder: "{{ $trigger.email }}" },
    { name: "channel",  type: "string", required: true,  description: "email | sms | push", placeholder: "email" },
    { name: "template", type: "string", required: false, description: "Template name", placeholder: "order-confirmed" },
    { name: "data",     type: "object", required: false, description: "Template variables", placeholder: "{}" },
  ],
  // ── Medusa Core Workflows ──────────────────────────────────────────────────
  "createProductsWorkflow": [
    { name: "products", type: "array", required: true, description: "Array of product objects to create" },
  ],
  "updateProductsWorkflow": [
    { name: "products", type: "array", required: true, description: "Array of { id, ...updates } objects" },
  ],
  "deleteProductsWorkflow": [
    { name: "ids", type: "array", required: true, description: "Array of product IDs to delete" },
  ],
  "createProductVariantsWorkflow": [
    { name: "product_variants", type: "array", required: true, description: "Array of variant objects with product_id" },
  ],
  "updateProductVariantsWorkflow": [
    { name: "product_variants", type: "array", required: true, description: "Array of { id, ...updates }" },
  ],
  "createOrderWorkflow": [
    { name: "region_id",         type: "id",     required: true,  description: "Region ID", placeholder: "reg_..." },
    { name: "customer_id",       type: "id",     required: false, description: "Customer ID", placeholder: "cus_..." },
    { name: "email",             type: "string", required: false, description: "Customer email", placeholder: "{{ $trigger.email }}" },
    { name: "items",             type: "array",  required: true,  description: "Array of { variant_id, quantity }" },
    { name: "shipping_address",  type: "object", required: false, description: "Shipping address object" },
    { name: "billing_address",   type: "object", required: false, description: "Billing address object" },
    { name: "shipping_methods",  type: "array",  required: false, description: "Array of { name, amount }" },
    { name: "metadata",          type: "object", required: false, description: "Arbitrary metadata" },
  ],
  "cancelOrderWorkflow": [
    { name: "order_id",      type: "id",     required: true,  description: "Order ID to cancel", placeholder: "{{ $last.id }}" },
    { name: "canceled_by",   type: "string", required: false, description: "Who cancelled (user/system)" },
  ],
  "createFulfillmentWorkflow": [
    { name: "order_id",         type: "id",    required: true,  description: "Order ID" },
    { name: "items",            type: "array", required: true,  description: "Array of { id, quantity } line items" },
    { name: "location_id",      type: "id",    required: true,  description: "Stock location ID" },
    { name: "provider_id",      type: "string", required: false, description: "Fulfillment provider ID" },
    { name: "metadata",         type: "object", required: false, description: "Metadata" },
  ],
  "createReturnWorkflow": [
    { name: "order_id",     type: "id",    required: true,  description: "Order ID", placeholder: "{{ $last.order_id }}" },
    { name: "items",        type: "array", required: true,  description: "Array of { id, quantity, reason_id? }" },
    { name: "return_shipping", type: "object", required: false, description: "Return shipping { option_id, price? }" },
    { name: "note",         type: "string", required: false, description: "Return note" },
    { name: "metadata",     type: "object", required: false, description: "Metadata" },
  ],
  "createCartWorkflow": [
    { name: "region_id",    type: "id",     required: true,  description: "Region ID", placeholder: "reg_..." },
    { name: "customer_id",  type: "id",     required: false, description: "Customer ID" },
    { name: "email",        type: "string", required: false, description: "Customer email" },
    { name: "items",        type: "array",  required: false, description: "Array of { variant_id, quantity }" },
    { name: "sales_channel_id", type: "id", required: false, description: "Sales channel ID" },
    { name: "metadata",     type: "object", required: false, description: "Metadata" },
  ],
  "createCustomerWorkflow": [
    { name: "first_name", type: "string", required: false, description: "First name", placeholder: "{{ $trigger.first_name }}" },
    { name: "last_name",  type: "string", required: false, description: "Last name" },
    { name: "email",      type: "string", required: true,  description: "Customer email", placeholder: "{{ $trigger.email }}" },
    { name: "phone",      type: "string", required: false, description: "Phone number" },
    { name: "metadata",   type: "object", required: false, description: "Metadata" },
  ],
  "updateCustomersWorkflow": [
    { name: "selector", type: "object", required: true,  description: "Filter to match customers" },
    { name: "update",   type: "object", required: true,  description: "Fields to update" },
  ],
  "deleteCustomersWorkflow": [
    { name: "ids", type: "array", required: true, description: "Array of customer IDs" },
  ],
  "createInventoryItemsWorkflow": [
    { name: "input", type: "array", required: true, description: "Array of inventory item objects" },
  ],
  "updateInventoryItemsWorkflow": [
    { name: "input", type: "array", required: true, description: "Array of { id, ...updates }" },
  ],
  "deleteInventoryItemWorkflow": [
    { name: "id", type: "id", required: true, description: "Inventory item ID" },
  ],
  "adjustInventoryLevelsWorkflow": [
    { name: "input", type: "array", required: true, description: "Array of { inventory_item_id, location_id, adjustment }" },
  ],
  "createStockLocationsWorkflow": [
    { name: "input", type: "array", required: true, description: "Array of stock location objects" },
  ],
  "sendNotificationsWorkflow": [
    { name: "notifications", type: "array", required: true, description: "Array of { to, channel, template, data }" },
  ],
}

/**
 * Build a basic input schema from the workflow name when no static entry exists.
 * Returns a minimal set of fields inferred from common naming patterns.
 */
function inferFieldsFromName(workflowName: string): WorkflowInputField[] {
  const n = workflowName.toLowerCase()
  if (n.includes("create-") || n.includes("add-")) {
    return [
      { name: "data", type: "object", required: true, description: "Fields for the new record", placeholder: "{{ $last }}" },
    ]
  }
  if (n.includes("update-") || n.includes("edit-") || n.includes("patch-")) {
    return [
      { name: "id",   type: "id",     required: true,  description: "Record ID to update", placeholder: "{{ $last.id }}" },
      { name: "data", type: "object", required: false, description: "Fields to update", placeholder: "{}" },
    ]
  }
  if (n.includes("delete-") || n.includes("remove-") || n.includes("archive-")) {
    return [
      { name: "id", type: "id", required: true, description: "Record ID to delete", placeholder: "{{ $last.id }}" },
    ]
  }
  if (n.includes("send-") || n.includes("notify") || n.includes("email")) {
    return [
      { name: "to",      type: "string", required: true,  description: "Recipient", placeholder: "{{ $trigger.email }}" },
      { name: "subject", type: "string", required: false, description: "Subject line", placeholder: "Notification" },
      { name: "data",    type: "object", required: false, description: "Payload data", placeholder: "{}" },
    ]
  }
  if (n.includes("assign-")) {
    return [
      { name: "id",          type: "id", required: true, description: "Record ID", placeholder: "{{ $last.id }}" },
      { name: "assignee_id", type: "id", required: true, description: "Assignee ID", placeholder: "{{ $trigger.user_id }}" },
    ]
  }
  // Generic fallback
  return [
    { name: "id",   type: "id",     required: false, description: "Record ID (if applicable)", placeholder: "{{ $last.id }}" },
    { name: "data", type: "object", required: false, description: "Input payload", placeholder: "{}" },
  ]
}

/**
 * GET /admin/visual-flows/metadata?debug=workflows
 *
 * Passing ?debug=workflows skips the normal response and returns a raw dump of
 * every registered workflow in WorkflowManager, along with what the source
 * scanner found for it. Useful for auditing which workflows have input schemas.
 */
function buildWorkflowDebugDump() {
  const allWorkflows = WorkflowManager.getWorkflows()
  const fileMap = getWorkflowFileMap()

  const rows: any[] = []
  for (const [id, def] of allWorkflows.entries()) {
    const staticSchema   = WORKFLOW_INPUT_SCHEMAS[id] ?? null
    const scannedSchema  = (() => { const f = getInputFieldsFromSourceFile(id); return f.length > 0 ? f : null })()
    const inferredSchema = inferFieldsFromName(id)

    const sourceFile = fileMap.get(id) ?? null

    // What's actually stored in WorkflowManager
    const managerKeys = Object.keys(def).filter(k => k !== "handler" && k !== "orchestrator")

    rows.push({
      id,
      // WorkflowManager raw fields (types-erased — no input schema here)
      manager: {
        keys: managerKeys,
        options: (def as any).options ?? {},
        requiredModules: (def as any).requiredModules ? [...(def as any).requiredModules] : [],
        optionalModules: (def as any).optionalModules ? [...(def as any).optionalModules] : [],
        stepCount: (() => {
          const h = (def as any).handlers_
          return h instanceof Map ? h.size : 0
        })(),
      },
      // Schema resolution
      schema: (() => {
        const genEntry = getGeneratedSchemas()[id]
        const genSchema = genEntry && genEntry.source !== "inferred" ? genEntry.fields : null
        const final = staticSchema ?? genSchema ?? scannedSchema ?? inferredSchema
        const finalSource = staticSchema ? "static_registry"
          : genSchema ? `generated_json(${genEntry?.source})`
          : scannedSchema ? "live_source_scan"
          : "name_heuristic"
        return {
          source: finalSource,
          sourceFile: (genEntry?.sourceFile ?? (sourceFile ? sourceFile.replace(process.cwd(), "~") : null)),
          fields: final.map((f: WorkflowInputField) => `${f.required ? "*" : ""}${f.name}:${f.type}`),
        }
      })(),
    })
  }

  rows.sort((a, b) => a.id.localeCompare(b.id))
  return rows
}

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
    // Debug mode: return raw workflow registry dump
    if ((req.query as any).debug === "workflows") {
      return res.json({
        total: WorkflowManager.getWorkflows().size,
        sourceFilesScanned: getWorkflowFileMap().size,
        workflows: buildWorkflowDebugDump(),
      })
    }

    // Get all registered services from the Awilix container
    const registeredModules = getRegisteredModulesFromContainer(req.scope)

    if (process.env.VISUAL_FLOWS_METADATA_DEBUG === "true") {
      const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
      const registrations = (req.scope as any)?.registrations || {}
      const registrationKeys = Object.keys(registrations)

      logger.info(
        `[visual-flows/metadata] registrations=${registrationKeys.length} modules=${registeredModules.length}`
      )
      logger.info(
        `[visual-flows/metadata] modules(sample)=${registeredModules
          .slice(0, 50)
          .map((m) => `${m.name}->${m.entityName}`)
          .join(", ")}`
      )
    }
    
    // Get queryable entities (modules that can be used with query.graph)
    const entities = await getQueryableEntities(req.scope, registeredModules)

    if (process.env.VISUAL_FLOWS_METADATA_DEBUG === "true") {
      const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
      logger.info(`[visual-flows/metadata] entities=${entities.length}`)
      logger.info(
        `[visual-flows/metadata] nonQueryable(sample)=${entities
          .filter((e) => !e.queryable)
          .slice(0, 50)
          .map((e) => `${e.name}(${e.moduleName})=${e.queryError || "unknown"}`)
          .join(" | ")}`
      )
    }
    
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

    // Only consider module-like registrations for custom modules.
    // Awilix container also holds many service/model registrations like "Ad", "Agreement",
    // "AnalyticsEvent", etc. These are not Remote Query entities and will fail query.graph
    // with "Service with alias ... was not found".
    if (/[A-Z]/.test(key)) {
      continue
    }
    if (!/^[a-z0-9_]+$/.test(key)) {
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
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  
  // Process all modules and verify queryability
  for (const mod of modules) {
    const modelEntityNames = mod.type === "custom" ? getModelEntityNamesFromModule(container, mod.name) : []
    const entityNamesToProbe = modelEntityNames.length > 0 ? modelEntityNames : [mod.entityName]

    if (process.env.VISUAL_FLOWS_METADATA_DEBUG === "true" && modelEntityNames.length > 0) {
      logger.info(
        `[visual-flows/metadata] module=${mod.name} models(sample)=${modelEntityNames.slice(0, 30).join(", ")}`
      )
    }

    for (const entityName of entityNamesToProbe) {
      let queryable = false
      let queryError: string | undefined
      let fields: FieldMetadata[] = []

      try {
        // Attempt a query to verify the entity is queryable and get sample data
        const result = await query.graph({
          entity: entityName,
          fields: ["*"],
          pagination: { take: 1 },
        })
        queryable = true
        queryError = undefined

        // Extract field names from the result
        if (result.data && result.data.length > 0) {
          const sampleRecord = result.data[0]
          fields = extractFieldsFromRecord(sampleRecord)
        }
      } catch (e: any) {
        // Entity might not be queryable via graph - that's okay
        queryable = false
        queryError = e?.message || "Entity is not queryable via query.graph"
      }

      entities.push({
        name: entityName,
        type: mod.type,
        description:
          modelEntityNames.length > 0
            ? `${mod.description} (model: ${entityName})`
            : mod.description,
        queryable,
        queryError: queryable ? undefined : queryError,
        moduleName: mod.name,
        fields: fields.length > 0 ? fields : undefined,
      })
    }
  }
  
  // Sort: queryable first, then by type (custom before core), then alphabetically
  entities.sort((a, b) => {
    if (a.queryable !== b.queryable) return a.queryable ? -1 : 1
    if (a.type !== b.type) return a.type === "custom" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  
  return entities
}

function getModelEntityNamesFromModule(container: any, moduleName: string): string[] {
  try {
    const service = container.resolve(moduleName) as any
    if (!service || !service.constructor) {
      return []
    }

    const modelObjectsSymbol = Symbol.for("MedusaServiceModelObjectsSymbol")
    const modelObjects = ((service.constructor as any)[modelObjectsSymbol] ||
      (service as any)[modelObjectsSymbol]) as Record<string, any> | undefined
    if (!modelObjects || typeof modelObjects !== "object") {
      return []
    }

    const entityNames = Object.values(modelObjects)
      .map((config: any) => {
        if (DmlEntity.isDmlEntity(config) && typeof config.name === "string") {
          // Remote Query alias names are generated from the entity name by converting
          // to snake_case + pluralizing.
          // Examples:
          // - Ad -> ads
          // - AnalyticsEvent -> analytics_events
          // - analytics_event -> analytics_events
          const snake = camelToSnakeCase(config.name).toLowerCase()
          return pluralize(snake)
        }

        return undefined
      })
      .filter((n: any): n is string => typeof n === "string" && n.length > 0)

    return Array.from(new Set(entityNames))
  } catch {
    return []
  }
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
    
    // Priority: hand-crafted static registry → pre-generated JSON → live source scan → name heuristic
    const generatedEntry = getGeneratedSchemas()[name]
    const inputSchema =
      WORKFLOW_INPUT_SCHEMAS[name] ??
      (generatedEntry && generatedEntry.source !== "inferred" ? generatedEntry.fields : null) ??
      (() => { const f = getInputFieldsFromSourceFile(name); return f.length > 0 ? f : null })() ??
      (generatedEntry?.fields ?? null) ??
      inferFieldsFromName(name)

    workflows.push({
      name,
      description: `Workflow: ${name.replace(/-/g, " ")}`,
      category,
      steps,
      requiredModules,
      optionalModules,
      isScheduled: !!workflowDef.options?.schedule,
      inputSchema,
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
  queryError?: string
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
  inputSchema?: WorkflowInputField[]
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
  if (lowerName.startsWith("inbound_email") || lowerName.includes("inbound_email")) return "email"

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

    // Inbound Email events
    { name: "inbound_emails.inbound-email.created", description: "When an inbound email is received", category: "email" },
    { name: "inbound_emails.inbound-email.updated", description: "When an inbound email is updated", category: "email" },
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
