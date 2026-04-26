/**
 * Event Chain Parser Service
 *
 * Parses event subscribers and workflows to build event chains showing:
 * - What happens when events are triggered
 * - Which workflows are invoked
 * - What entities are affected
 * - Cascading events
 *
 * This enables the AI to answer questions like:
 * - "What happens when an order is placed?"
 * - "How are production runs created?"
 */

import * as fs from "fs"
import * as path from "path"
import glob from "glob"
import { promisify } from "util"

const globAsync = promisify(glob)

/**
 * Entity access pattern
 */
export interface EntityAccess {
  entity: string
  operation: "read" | "create" | "update" | "delete"
  via?: string // e.g., "query.graph", "service call"
}

/**
 * Query pattern extracted from code
 */
export interface QueryPattern {
  entity: string
  fields: string[]
  filters?: string[]
}

/**
 * Parsed event subscriber
 */
export interface ParsedSubscriber {
  fileName: string
  eventName: string                    // e.g., "order.placed"
  triggeredWorkflows: string[]         // e.g., ["sendOrderConfirmationWorkflow"]
  entityAccess: EntityAccess[]         // What entities are read/written
  queryPatterns: QueryPattern[]        // Query.graph patterns used
}

/**
 * Workflow step
 */
export interface WorkflowStep {
  name: string
  description?: string
  entity?: string
  operation?: string
}

/**
 * Parsed workflow
 */
export interface ParsedWorkflow {
  name: string
  fileName: string
  inputFields: string[]
  steps: WorkflowStep[]
  affectedEntities: EntityAccess[]
  emittedEvents: string[]
}

/**
 * Complete event chain
 */
export interface EventChain {
  event: string
  subscribers: string[]
  workflows: string[]
  affectedEntities: EntityAccess[]
  cascadingEvents: string[]
  queryPatterns: QueryPattern[]
}

/**
 * Caches
 */
const subscriberCache: Map<string, ParsedSubscriber> = new Map()
const workflowCache: Map<string, ParsedWorkflow> = new Map()
let initialized = false

/**
 * Parse all subscribers
 */
export async function parseAllSubscribers(subscribersPath: string): Promise<Map<string, ParsedSubscriber>> {
  const pattern = path.join(subscribersPath, "*.ts").replace(/\\/g, "/")
  const files = await globAsync(pattern)

  console.log(`[EventChainParser] Found ${files.length} subscriber files`)

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const subscriber = parseSubscriberFile(content, path.basename(filePath))

      if (subscriber) {
        subscriberCache.set(subscriber.eventName, subscriber)
        const workflows = subscriber.triggeredWorkflows.length > 0
          ? ` → ${subscriber.triggeredWorkflows.join(", ")}`
          : ""
        console.log(`[EventChainParser] Parsed subscriber: ${subscriber.eventName}${workflows}`)
      }
    } catch (error) {
      console.warn(`[EventChainParser] Failed to parse ${filePath}:`, error)
    }
  }

  return subscriberCache
}

/**
 * Parse a subscriber file
 */
function parseSubscriberFile(content: string, fileName: string): ParsedSubscriber | null {
  // Extract event name from config
  const eventMatch = content.match(/event:\s*["']([^"']+)["']/)
  if (!eventMatch) return null

  const eventName = eventMatch[1]

  // Extract workflow imports
  const workflowImports = Array.from(
    content.matchAll(/import\s+[^;]*?(\w+Workflow)[^;]*?from\s+["'][^"']*workflows/gm)
  ).map((m) => m[1])

  // Extract workflow.run calls
  const workflowCalls = Array.from(
    content.matchAll(/(\w+Workflow)\s*\(\s*(?:container|req\.scope)\s*\)\s*\.run/g)
  ).map((m) => m[1])

  const triggeredWorkflows = [...new Set([...workflowImports, ...workflowCalls])]

  // Extract query.graph patterns
  const queryPatterns: QueryPattern[] = []
  const graphMatches = content.matchAll(/query\.graph\s*\(\s*\{([\s\S]*?)\}\s*\)/g)

  for (const match of graphMatches) {
    const block = match[1]
    const entityMatch = block.match(/entity:\s*["'](\w+)["']/)
    const fieldsMatch = block.match(/fields:\s*\[([^\]]+)\]/)

    if (entityMatch) {
      queryPatterns.push({
        entity: entityMatch[1],
        fields: fieldsMatch
          ? fieldsMatch[1].split(",").map((f) => f.trim().replace(/["']/g, ""))
          : ["*"],
      })
    }
  }

  // Extract entity access patterns
  const entityAccess: EntityAccess[] = []

  // Look for service.retrieve/create/update patterns
  const servicePatterns: Array<{ regex: RegExp; op: EntityAccess["operation"]; entity?: string }> = [
    { regex: /(\w+)Service\.retrieve\w+/g, op: "read" },
    { regex: /(\w+)Service\.list\w+/g, op: "read" },
    { regex: /(\w+)Service\.create\w+/g, op: "create" },
    { regex: /(\w+)Service\.update\w+/g, op: "update" },
    { regex: /(\w+)Service\.delete\w+/g, op: "delete" },
  ]

  // Also detect workflow-based entity creation
  const workflowEntityPatterns: Array<{ pattern: string; entity: string; op: EntityAccess["operation"] }> = [
    { pattern: "createProductionRunWorkflow", entity: "production_run", op: "create" },
    { pattern: "sendOrderConfirmationWorkflow", entity: "notification", op: "create" },
    { pattern: "createTasksWorkflow", entity: "task", op: "create" },
  ]

  for (const { pattern: wfPattern, entity, op } of workflowEntityPatterns) {
    if (content.includes(wfPattern)) {
      entityAccess.push({ entity, operation: op, via: "workflow" })
    }
  }

  for (const { regex, op } of servicePatterns) {
    const matches = content.matchAll(regex)
    for (const match of matches) {
      const serviceName = match[1]
      // Convert service name to entity (e.g., "order" from "orderService")
      const entity = serviceName.toLowerCase()
      if (!entityAccess.some((e) => e.entity === entity && e.operation === op)) {
        entityAccess.push({ entity, operation: op, via: "service call" })
      }
    }
  }

  // Add entities from query patterns
  for (const qp of queryPatterns) {
    if (!entityAccess.some((e) => e.entity === qp.entity && e.operation === "read")) {
      entityAccess.push({
        entity: qp.entity,
        operation: "read",
        via: "query.graph",
      })
    }
  }

  return {
    fileName,
    eventName,
    triggeredWorkflows,
    entityAccess,
    queryPatterns,
  }
}

/**
 * Parse all workflow files
 */
export async function parseAllWorkflows(workflowsPath: string): Promise<Map<string, ParsedWorkflow>> {
  const pattern = path.join(workflowsPath, "**/*.ts").replace(/\\/g, "/")
  const files = await globAsync(pattern)

  console.log(`[WorkflowParser] Found ${files.length} workflow files`)

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const workflows = parseWorkflowFile(content, path.basename(filePath))

      for (const wf of workflows) {
        workflowCache.set(wf.name, wf)
        console.log(`[WorkflowParser] Parsed: ${wf.name} (${wf.steps.length} steps)`)
      }
    } catch (error) {
      // Skip files that don't contain workflows (most will)
    }
  }

  return workflowCache
}

/**
 * Parse a workflow file
 */
function parseWorkflowFile(content: string, fileName: string): ParsedWorkflow[] {
  const workflows: ParsedWorkflow[] = []

  // Match workflow exports
  const workflowMatches = content.matchAll(
    /export\s+(?:const|default|function)\s+(\w+Workflow)\s*=/g
  )

  for (const match of workflowMatches) {
    const name = match[1]

    // Extract input type fields
    const inputFields: string[] = []
    const inputTypeMatch = content.match(new RegExp(`type\\s+\\w*Input\\w*\\s*=\\s*\\{([^}]+)\\}`))
    if (inputTypeMatch) {
      const fieldMatches = inputTypeMatch[1].matchAll(/(\w+)\s*[?]?:/g)
      for (const fm of fieldMatches) {
        inputFields.push(fm[1])
      }
    }

    // Extract step names
    const steps: WorkflowStep[] = []
    const stepMatches = content.matchAll(/createStep\s*\(\s*["']([^"']+)["']/g)
    for (const stepMatch of stepMatches) {
      steps.push({ name: stepMatch[1] })
    }

    // Extract affected entities from service calls
    const affectedEntities: EntityAccess[] = []

    // Look for .create, .update, .delete patterns
    const createPatterns = content.matchAll(/\.create(\w+)s?\s*\(/g)
    for (const cp of createPatterns) {
      const entity = cp[1].toLowerCase()
      if (!affectedEntities.some((e) => e.entity === entity && e.operation === "create")) {
        affectedEntities.push({ entity, operation: "create" })
      }
    }

    const updatePatterns = content.matchAll(/\.update(\w+)s?\s*\(/g)
    for (const up of updatePatterns) {
      const entity = up[1].toLowerCase()
      if (!affectedEntities.some((e) => e.entity === entity && e.operation === "update")) {
        affectedEntities.push({ entity, operation: "update" })
      }
    }

    // Extract emitted events
    const emittedEvents: string[] = []
    const eventEmitMatches = content.matchAll(/eventBus\.emit\s*\(\s*["']([^"']+)["']/g)
    for (const em of eventEmitMatches) {
      emittedEvents.push(em[1])
    }

    // Also check for event emission via container
    const containerEventMatches = content.matchAll(/\.emit\s*\(\s*["']([^"']+)["']/g)
    for (const cem of containerEventMatches) {
      if (!emittedEvents.includes(cem[1])) {
        emittedEvents.push(cem[1])
      }
    }

    workflows.push({
      name,
      fileName,
      inputFields,
      steps,
      affectedEntities,
      emittedEvents,
    })
  }

  return workflows
}

/**
 * Initialize both parsers
 */
export async function initializeEventChainParser(
  subscribersPath: string,
  workflowsPath: string
): Promise<void> {
  if (initialized) return

  await parseAllSubscribers(subscribersPath)
  await parseAllWorkflows(workflowsPath)

  initialized = true
}

/**
 * Build event chain for a given event
 */
export function buildEventChain(eventName: string): EventChain | null {
  const subscriber = subscriberCache.get(eventName)
  if (!subscriber) return null

  const chain: EventChain = {
    event: eventName,
    subscribers: [subscriber.fileName],
    workflows: [...subscriber.triggeredWorkflows],
    affectedEntities: [...subscriber.entityAccess],
    cascadingEvents: [],
    queryPatterns: [...subscriber.queryPatterns],
  }

  // Find cascading events from triggered workflows
  for (const wfName of subscriber.triggeredWorkflows) {
    const workflow = workflowCache.get(wfName)
    if (workflow) {
      // Add workflow's affected entities
      for (const ea of workflow.affectedEntities) {
        if (!chain.affectedEntities.some((e) => e.entity === ea.entity && e.operation === ea.operation)) {
          chain.affectedEntities.push(ea)
        }
      }

      // Add cascading events
      for (const event of workflow.emittedEvents) {
        if (!chain.cascadingEvents.includes(event)) {
          chain.cascadingEvents.push(event)
        }
      }
    }
  }

  return chain
}

/**
 * Get all event chains
 */
export function getAllEventChains(): EventChain[] {
  const chains: EventChain[] = []

  for (const eventName of subscriberCache.keys()) {
    const chain = buildEventChain(eventName)
    if (chain) {
      chains.push(chain)
    }
  }

  return chains
}

/**
 * Find relevant event chains for detected entities
 */
export function findRelevantEventChains(entities: string[]): EventChain[] {
  const relevant: EventChain[] = []
  const normalizedEntities = entities.map((e) => e.toLowerCase().replace(/_/g, ""))

  for (const [eventName] of subscriberCache) {
    const chain = buildEventChain(eventName)
    if (!chain) continue

    // Check if any affected entity matches
    const matches = chain.affectedEntities.some((ea) => {
      const normalizedEntity = ea.entity.toLowerCase().replace(/_/g, "")
      return normalizedEntities.some((ne) => ne === normalizedEntity || normalizedEntity.includes(ne))
    })

    if (matches) {
      relevant.push(chain)
    }
  }

  return relevant
}

/**
 * Build LLM-friendly documentation for an event chain
 */
export function buildEventChainDocForLLM(eventName: string): string | null {
  const chain = buildEventChain(eventName)
  if (!chain) return null

  const lines: string[] = [`### Event: ${eventName}`, ""]

  if (chain.workflows.length > 0) {
    lines.push(`**Triggers Workflows:**`)
    for (const wf of chain.workflows) {
      lines.push(`  - ${wf}`)
    }
    lines.push("")
  }

  if (chain.affectedEntities.length > 0) {
    lines.push(`**Affected Entities:**`)

    // Group by entity
    const grouped = new Map<string, Set<string>>()
    for (const ea of chain.affectedEntities) {
      if (!grouped.has(ea.entity)) {
        grouped.set(ea.entity, new Set())
      }
      grouped.get(ea.entity)!.add(ea.operation)
    }

    for (const [entity, ops] of grouped) {
      lines.push(`  - ${entity}: ${Array.from(ops).join(", ")}`)
    }
    lines.push("")
  }

  if (chain.queryPatterns.length > 0) {
    lines.push(`**Query Paths:**`)
    for (const qp of chain.queryPatterns) {
      const fieldsPreview = qp.fields.slice(0, 3).join(", ")
      const suffix = qp.fields.length > 3 ? ", ..." : ""
      lines.push(`  - ${qp.entity}: [${fieldsPreview}${suffix}]`)
    }
    lines.push("")
  }

  if (chain.cascadingEvents.length > 0) {
    lines.push(`**Cascading Events:**`)
    for (const ev of chain.cascadingEvents) {
      lines.push(`  - ${ev}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Build comprehensive event context for query planner
 */
export function buildEventContextForLLM(entities: string[]): string {
  const chains = findRelevantEventChains(entities)
  if (chains.length === 0) return ""

  const lines: string[] = [
    "## Event Chains (Business Logic Flows)",
    "",
    "These events affect the entities in your query:",
    "",
  ]

  for (const chain of chains) {
    const doc = buildEventChainDocForLLM(chain.event)
    if (doc) lines.push(doc)
  }

  return lines.join("\n")
}

/**
 * Get subscriber by event name
 */
export function getSubscriber(eventName: string): ParsedSubscriber | undefined {
  return subscriberCache.get(eventName)
}

/**
 * Get workflow by name
 */
export function getWorkflow(workflowName: string): ParsedWorkflow | undefined {
  return workflowCache.get(workflowName)
}

/**
 * Check if event chain parser is initialized
 */
export function isEventChainParserInitialized(): boolean {
  return initialized
}

/**
 * Clear caches (for testing)
 */
export function clearEventChainCache(): void {
  subscriberCache.clear()
  workflowCache.clear()
  initialized = false
}
