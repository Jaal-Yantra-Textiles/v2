// @ts-nocheck
/**
 * AI Chat Workflow
 *
 * Simplified AI chat workflow using the Hybrid Query Resolver.
 *
 * Features:
 * 1. Uses BM25 + LLM for query resolution
 * 2. Pre-indexed docs for fast common queries
 * 3. Simple 5-step pipeline
 * 4. Direct execution of generated code
 *
 * Steps:
 * 1. resolveQueryStep - Uses HybridQueryResolverService for intent/entity/plan
 * 2. executeActionStep - Executes the generated plan
 * 3. generateResponseStep - LLM generates user-facing response
 * 4. saveToMemoryStep - Persists conversation
 * 5. learnFromResultStep - Stores successful patterns
 */

import { createWorkflow, createStep } from "@mastra/core/workflows"
import { z } from "@medusajs/framework/zod"
import { v4 as uuidv4 } from "uuid"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"
import { MedusaContainer } from "@medusajs/framework"

// Services
import {
  HybridQueryResolverService,
  getHybridQueryResolver,
  ResolvedQuery,
  ExecutionStep as ResolvedStep,
  ClarificationContext,
  ClarificationOption,
} from "../../services/hybrid-query-resolver"
import { resolveServiceKey } from "../../services/module-registry"
import { memory } from "../../memory"

// Model rotation
import {
  generateRequestId,
  getModelsForStep,
  isRateLimitError,
  markModelRateLimited,
  markModelSuccess,
  waitForRateLimit,
  waitAfterRateLimit,
} from "../../services/model-rotator"

// Logger
import { workflowLogger as log } from "../../services/logger"

// Schemas
const clarificationOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  module: z.string(),
  apiPath: z.string().optional(),
})

const clarificationContextSchema = z.object({
  selectedOptionId: z.string(),
  selectedModule: z.string(),
  originalQuery: z.string(),
})

const inputSchema = z.object({
  message: z.string(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  context: z.record(z.any()).optional(),
  // Human-in-the-loop: clarification from previous interaction
  clarification: clarificationContextSchema.optional(),
})

const outputSchema = z.object({
  reply: z.string().optional(),
  steps: z.array(z.any()).optional(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  model: z.string().optional(),
  mode: z.string().optional(),
  runId: z.string().optional(),
  resolvedQuery: z.any().optional(),
  // Human-in-the-loop: when clarification is needed
  needsClarification: z.boolean().optional(),
  clarificationMessage: z.string().optional(),
  clarificationOptions: z.array(clarificationOptionSchema).optional(),
})

// Helper to safely stringify
function safeJson(v: any, max = 2000): string {
  try {
    if (v == null) return ""
    const s = typeof v === "string" ? v : JSON.stringify(v, null, 2)
    return s.length > max ? s.slice(0, max) + "..." : s
  } catch {
    return String(v || "").slice(0, max)
  }
}

// ============================================
// STEP 1: Resolve Query with Hybrid Resolver
// ============================================

const resolveQueryStep = createStep({
  id: "aiv4:resolve-query",
  inputSchema,
  outputSchema: inputSchema.extend({
    requestId: z.string().optional(),
    resolvedQuery: z.any().optional(),
    resolveError: z.string().optional(),
    resolveDurationMs: z.number().optional(),
    // Human-in-the-loop fields
    needsClarification: z.boolean().optional(),
    clarificationMessage: z.string().optional(),
    clarificationOptions: z.array(clarificationOptionSchema).optional(),
  }),
  execute: async ({ inputData }) => {
    const { message, context, clarification } = inputData
    const requestId = generateRequestId()
    const startTime = Date.now()

    log.operationStart("V4 Resolve Query", {
      requestId,
      query: message?.slice(0, 100),
      hasClarification: !!clarification,
    })

    try {
      // Get singleton resolver (loads contextual index once, reuses across queries)
      // First call ~500ms (loads 1,312 contextual chunks), subsequent calls <1ms
      const resolver = await getHybridQueryResolver()

      // Resolve the query, passing clarification context if provided
      const resolved = await resolver.resolve(message, clarification)
      const durationMs = Date.now() - startTime

      // Check if clarification is needed (human-in-the-loop)
      if (resolved.needsClarification) {
        log.info("Clarification needed", {
          message: resolved.clarificationMessage,
          optionsCount: resolved.clarificationOptions?.length || 0,
          durationMs,
        })

        return {
          ...inputData,
          requestId,
          resolvedQuery: resolved,
          resolveDurationMs: durationMs,
          // Pass through clarification fields
          needsClarification: true,
          clarificationMessage: resolved.clarificationMessage,
          clarificationOptions: resolved.clarificationOptions,
        }
      }

      log.info("Query resolved", {
        entity: resolved.targetEntity,
        mode: resolved.mode,
        source: resolved.source,
        confidence: resolved.confidence,
        stepsCount: resolved.executionPlan?.length || 0,
        durationMs,
      })

      return {
        ...inputData,
        requestId,
        resolvedQuery: resolved,
        resolveDurationMs: durationMs,
      }
    } catch (error) {
      const durationMs = Date.now() - startTime
      log.error("Query resolution failed", { error: String(error), durationMs })

      return {
        ...inputData,
        requestId,
        resolvedQuery: null,
        resolveError: error instanceof Error ? error.message : String(error),
        resolveDurationMs: durationMs,
      }
    }
  },
})

// ============================================
// STEP 2: Execute the Resolved Plan
// ============================================

/**
 * Execute a single step from the resolved plan
 *
 * The hybrid resolver generates code like:
 *   await designService.listDesigns({}, { relations: ['specifications'] })
 *
 * We parse and execute these dynamically using the container.
 */
async function executeResolvedStep(
  container: MedusaContainer,
  step: ResolvedStep,
  previousResults: Map<number, any>,
  authHeaders?: { authorization?: string; cookie?: string }
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { method, code, step: stepNum } = step

  log.debug("Executing step", { stepNum, method, code: code?.slice(0, 100) })

  try {
    // Get the last result from previous steps to pass as 'result'
    const lastStepNum = previousResults.size > 0 ? Math.max(...previousResults.keys()) : 0
    let lastResult = previousResults.get(lastStepNum) ?? null

    // Normalize listAndCount results: [items, count] -> { items, count }
    // This makes it easier for LLM-generated code to access count
    if (Array.isArray(lastResult) && lastResult.length === 2 && typeof lastResult[1] === "number") {
      lastResult = { items: lastResult[0], count: lastResult[1] }
    }

    // Handle API method for core Medusa entities
    // Format: GET /admin/collections or GET /admin/collections?fields=+products
    if (method === "api") {
      // Parse HTTP method and path
      const apiMatch = code.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.+)$/i)
      if (!apiMatch) {
        return { success: false, error: `Could not parse API call: ${code}` }
      }

      const [, httpMethod, pathWithQuery] = apiMatch

      // Build the full URL
      const baseUrl = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
      const url = `${baseUrl}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`

      log.debug("Executing API call", { httpMethod, url: url.slice(0, 100) })

      try {
        // Build headers - use auth from request context if available
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        }

        // Prefer authorization header from request context for authenticated calls
        if (authHeaders?.authorization) {
          headers["Authorization"] = authHeaders.authorization
        } else if (process.env.MEDUSA_ADMIN_API_TOKEN) {
          // Fallback to API token if available
          headers["x-medusa-access-token"] = process.env.MEDUSA_ADMIN_API_TOKEN
        }

        // Pass through cookie if available (for session-based auth)
        if (authHeaders?.cookie) {
          headers["Cookie"] = authHeaders.cookie
        }

        // Make the HTTP request
        const response = await fetch(url, {
          method: httpMethod.toUpperCase(),
          headers,
        })

        if (!response.ok) {
          const errorText = await response.text()
          log.warn("API call failed", { status: response.status, url, error: errorText.slice(0, 200) })
          return { success: false, error: `API call failed: ${response.status} - ${errorText.slice(0, 200)} [URL: ${url}]` }
        }

        const data = await response.json()

        // Medusa API responses typically have the data in a property named after the entity
        // e.g., { collections: [...] } or { products: [...] }
        // We'll return the full response and let downstream handle it
        return { success: true, data }
      } catch (fetchError) {
        log.error("API fetch error", { error: String(fetchError) })
        return { success: false, error: `API fetch failed: ${fetchError}` }
      }
    }

    if (method === "javascript") {
      // JavaScript steps are typically helper calculations (e.g., date math, formatting)
      // We provide both 'result' and extracted common variables (count, items) for LLM convenience
      // LLM might generate: `return { totalPartners: count }` OR `return { totalPartners: result.count }`
      try {
        // Extract common variables from lastResult so LLM code can reference them directly
        const count = lastResult?.count
        const items = lastResult?.items
        const data = lastResult?.data ?? lastResult

        log.debug("Javascript step executing", {
          hasCount: count !== undefined,
          count,
          hasItems: items !== undefined,
          itemsLength: items?.length,
          code: code?.slice(0, 80),
        })

        const fn = new Function("result", "previousResults", "Date", "count", "items", "data", `
          const results = previousResults;
          ${code}
        `)
        const output = fn(lastResult, previousResults, Date, count, items, data)
        return { success: true, data: output ?? lastResult }
      } catch (evalError) {
        log.warn("Javascript eval failed, passing through last result", {
          error: String(evalError),
          code: code?.slice(0, 50),
        })
        // If the code fails, just pass through the last result
        return { success: true, data: lastResult }
      }
    }

    if (method === "service") {
      // Parse the service call from code
      // Format: await serviceName.methodName(filters, config)
      const serviceMatch = code.match(/await\s+(\w+)\.(\w+)\((.*)\)/s)
      if (!serviceMatch) {
        return { success: false, error: `Could not parse service call: ${code}` }
      }

      const [, serviceName, methodName, argsStr] = serviceMatch

      // Try to resolve service using the module registry first
      const tryResolve = (key: string) => {
        try {
          return container.resolve(key)
        } catch {
          return null
        }
      }

      // Use module registry to resolve the correct service key
      const resolvedKey = resolveServiceKey(serviceName)
      let service: any = null

      if (resolvedKey) {
        service = tryResolve(resolvedKey)
        if (service) {
          log.debug("Service resolved via module registry", { serviceName, resolvedKey })
        }
      }

      // Fallback: try pattern matching if module registry didn't find it
      if (!service) {
        const moduleKey = serviceName.replace(/Service$/i, "").toLowerCase()

        // Split camelCase into parts (e.g., "mediaFile" -> ["media", "file"])
        const camelCaseParts = serviceName
          .replace(/Service$/i, "")
          .split(/(?=[A-Z])/)
          .map((s) => s.toLowerCase())

        // Common naming patterns in Medusa
        const patterns = [
          moduleKey,                              // mediafile
          `${moduleKey}_service`,                 // mediafile_service
          camelCaseParts[0],                      // media (first part of camelCase)
          camelCaseParts.join("_"),               // media_file (snake_case)
          camelCaseParts[0].replace(/s$/, ""),    // media (singular)
        ]

        const uniquePatterns = [...new Set(patterns.filter(Boolean))]

        for (const pattern of uniquePatterns) {
          service = tryResolve(pattern)
          if (service) {
            log.debug("Service resolved via pattern matching", { serviceName, pattern })
            break
          }
        }

        if (!service) {
          log.warn("Service not found", { serviceName, triedPatterns: uniquePatterns, resolvedKey })
          return { success: false, error: `Service not found: ${serviceName}` }
        }
      }

      if (!service || typeof service[methodName] !== "function") {
        return { success: false, error: `Method not found: ${methodName} on ${serviceName}` }
      }

      // Parse arguments (simplified - assumes valid JSON-like syntax)
      let args: any[] = []
      try {
        // Replace single quotes with double quotes for JSON parsing
        const jsonArgs = `[${argsStr.replace(/'/g, '"')}]`
        args = JSON.parse(jsonArgs)
      } catch {
        // Try eval as fallback for complex expressions
        try {
          args = eval(`[${argsStr}]`)
        } catch {
          args = [{}, {}]
        }
      }

      // Execute the service call
      const result = await service[methodName](...args)

      // Normalize listAndCount results: [items, count] -> { items, count }
      // This allows LLM code like `const { count } = await service.listAndCount()` to work
      if (Array.isArray(result) && result.length === 2 && typeof result[1] === "number") {
        log.debug("Normalizing listAndCount result in service call", {
          count: result[1],
          itemsLength: result[0]?.length,
        })
        return { success: true, data: { items: result[0], count: result[1] } }
      }

      return { success: true, data: result }
    }

    if (method === "graph") {
      // Query graph for module links
      const query = container.resolve("query") as any

      // Parse the graph call
      const graphMatch = code.match(/query\.graph\(\s*(\{[\s\S]*\})\s*\)/)
      if (!graphMatch) {
        return { success: false, error: `Could not parse graph call: ${code}` }
      }

      // Parse the graph config
      let graphConfig: any
      try {
        graphConfig = eval(`(${graphMatch[1]})`)
      } catch {
        return { success: false, error: `Could not parse graph config: ${graphMatch[1]}` }
      }

      const result = await query.graph(graphConfig)
      return { success: true, data: result }
    }

    // Handle common fallback types as javascript
    // LLM sometimes generates "destructure", "format", "aggregate", "return" etc.
    if (["destructure", "format", "aggregate", "return", "transform", "filter", "map"].includes(method)) {
      log.debug("Converting unsupported method to javascript", { method, code: code?.slice(0, 50) })

      // Try to execute as javascript with access to previous results + extracted variables
      try {
        // Extract common variables from lastResult for LLM convenience
        const count = lastResult?.count
        const items = lastResult?.items
        const data = lastResult?.data ?? lastResult

        const fn = new Function("result", "previousResults", "count", "items", "data", `
          ${code}
        `)
        const output = fn(lastResult, previousResults, count, items, data)
        return { success: true, data: output ?? lastResult }
      } catch {
        // If the code fails, just pass through the last result
        if (lastResult) {
          // Extract count if it's a listAndCount result
          if (Array.isArray(lastResult) && lastResult.length === 2 && typeof lastResult[1] === "number") {
            return { success: true, data: { items: lastResult[0], count: lastResult[1] } }
          }
          return { success: true, data: lastResult }
        }
        return { success: true, data: null }
      }
    }

    return { success: false, error: `Unknown method type: ${method}` }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const executeActionStep = createStep({
  id: "aiv4:execute-action",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async ({ inputData, mapiContainerRef }) => {
    const { resolvedQuery, context, resolveError, needsClarification } = inputData

    // Skip if clarification is needed (human-in-the-loop)
    if (needsClarification) {
      log.info("Clarification needed - skipping data execution")
      return { ...inputData, fetchedData: null }
    }

    // Skip if resolution failed
    if (resolveError || !resolvedQuery) {
      return {
        ...inputData,
        fetchedData: null,
        executionError: resolveError || "No resolved query",
      }
    }

    const resolved = resolvedQuery as ResolvedQuery

    // For chat mode, skip data execution
    if (resolved.mode === "chat") {
      log.info("Chat mode - skipping data execution")
      return { ...inputData, fetchedData: null }
    }

    // Get container
    const container = mapiContainerRef?.deref?.() || (context as any)?.container
    if (!container) {
      log.error("No container available for service calls")
      return {
        ...inputData,
        fetchedData: null,
        executionError: "No container available",
      }
    }

    const plan = resolved.executionPlan || []
    if (plan.length === 0) {
      log.warn("Empty execution plan")
      return { ...inputData, fetchedData: null }
    }

    // Log execution plan details for debugging
    log.debug("Execution plan details", {
      stepsCount: plan.length,
      steps: plan.map((s: any) => ({
        step: s.step,
        method: s.method,
        code: s.code?.slice(0, 100),
      })),
    })

    log.operationStart("V4 Execute Plan", { stepsCount: plan.length })

    const stepResults = new Map<number, any>()
    const executionLogs: any[] = []
    const errors: string[] = []
    let finalData: any = null

    // Get auth headers from context for API calls
    const authHeaders = (context as any)?.auth_headers as { authorization?: string; cookie?: string } | undefined

    for (const step of plan) {
      const startTime = Date.now()
      const result = await executeResolvedStep(container, step, stepResults, authHeaders)
      const durationMs = Date.now() - startTime

      executionLogs.push({
        step: step.step,
        action: step.action,
        method: step.method,
        success: result.success,
        error: result.error,
        durationMs,
      })

      if (result.success && result.data) {
        let normalizedData = result.data
        // Normalize listAndCount results immediately: [items, count] -> { items, count }
        // This ensures subsequent javascript steps can access result.count
        if (Array.isArray(normalizedData) && normalizedData.length === 2 && typeof normalizedData[1] === "number") {
          normalizedData = { items: normalizedData[0], count: normalizedData[1] }
          log.debug("Normalized listAndCount result", { count: normalizedData.count, itemsCount: normalizedData.items?.length })
        }
        stepResults.set(step.step, normalizedData)
        finalData = normalizedData
      } else if (!result.success) {
        log.warn("Step failed", { step: step.step, error: result.error })
        errors.push(`Step ${step.step}: ${result.error}`)
        // Continue to next step - some failures are recoverable
      }
    }

    log.operationEnd("V4 Execute Plan", !!finalData, {
      stepsExecuted: plan.length,
      hasData: !!finalData,
      errorCount: errors.length,
    })

    // Build execution error message if any steps failed
    const executionError = errors.length > 0
      ? `Query execution encountered errors:\n${errors.join("\n")}`
      : null

    return {
      ...inputData,
      fetchedData: finalData,
      executionLogs,
      executionError,
      queryPlanSuccess: !!finalData,
    }
  },
})

// ============================================
// STEP 3: Generate Response with LLM
// ============================================

const generateResponseStep = createStep({
  id: "aiv4:generate-response",
  inputSchema: z.any(),
  outputSchema,
  execute: async ({ inputData }) => {
    const {
      message,
      threadId,
      resourceId,
      requestId,
      resolvedQuery,
      fetchedData,
      executionError,
      executionLogs,
      context,
      // Human-in-the-loop fields
      needsClarification,
      clarificationMessage,
      clarificationOptions,
    } = inputData

    const steps: any[] = []
    const pushStep = (type: string, data?: any) => {
      steps.push({ id: uuidv4(), type, ts: Date.now(), data })
    }

    // Handle clarification needed (human-in-the-loop)
    // Return early with clarification options - no LLM call needed
    if (needsClarification) {
      pushStep("clarification_needed", {
        message: clarificationMessage,
        optionsCount: clarificationOptions?.length || 0,
      })

      // Build a user-friendly clarification message
      const optionsList = (clarificationOptions || [])
        .map((opt: ClarificationOption, i: number) => `${i + 1}. **${opt.label}**: ${opt.description}`)
        .join("\n")

      const reply = `${clarificationMessage}\n\n${optionsList}\n\nPlease select an option to continue.`

      return {
        reply,
        steps,
        threadId,
        resourceId,
        mode: "clarification",
        // Pass through clarification fields for the API to use
        needsClarification: true,
        clarificationMessage,
        clarificationOptions,
      }
    }

    const resolved = resolvedQuery as ResolvedQuery | null
    const mode = resolved?.mode || "chat"

    pushStep("resolved", {
      entity: resolved?.targetEntity,
      mode,
      source: resolved?.source,
      confidence: resolved?.confidence,
    })

    // Build context for LLM
    let dataContext = ""
    if (fetchedData) {
      // Extract count from various possible field names (LLM might generate different keys)
      const countValue = fetchedData.count ?? fetchedData.totalPartners ?? fetchedData.total ?? fetchedData.totalCount

      // Extract items - check known keys first, then detect entity-specific keys from Medusa API
      // Medusa API returns data with entity names like { products: [...] }, { orders: [...] }, etc.
      let itemsValue = fetchedData.items ?? fetchedData.data ?? fetchedData.partners ?? fetchedData.results

      // If no standard key found, look for entity-specific array keys
      // Medusa API commonly returns: products, orders, customers, collections, categories, etc.
      if (!itemsValue) {
        const dataKeys = Object.keys(fetchedData)
        // Common Medusa entity keys (pluralized)
        const entityKeys = [
          "products", "orders", "customers", "collections", "categories", "regions",
          "currencies", "stores", "inventory_items", "stock_locations", "price_lists",
          "promotions", "campaigns", "tax_rates", "shipping_options", "payment_providers",
          "fulfillment_providers", "sales_channels", "api_keys", "users", "invites",
          "designs", "partners", "production_runs", "inventory_orders", "tasks",
          "feedbacks", "agreements", "persons", "media", "websites", "forms",
          "email_templates", "visual_flows", "social_posts", "publishing_campaigns",
          "feature_flags", "notifications", "payments",
        ]

        // First try known entity keys
        for (const key of entityKeys) {
          if (dataKeys.includes(key) && Array.isArray(fetchedData[key])) {
            itemsValue = fetchedData[key]
            log.debug("Found items via entity key", { key, count: itemsValue.length })
            break
          }
        }

        // If still not found, try any array key (excluding metadata keys)
        if (!itemsValue) {
          const metadataKeys = ["count", "offset", "limit", "total", "page", "pages"]
          for (const key of dataKeys) {
            if (!metadataKeys.includes(key) && Array.isArray(fetchedData[key])) {
              itemsValue = fetchedData[key]
              log.debug("Found items via dynamic array key", { key, count: itemsValue.length })
              break
            }
          }
        }
      }

      log.debug("Response generation data", {
        mode,
        countValue,
        hasItems: !!itemsValue,
        itemsCount: Array.isArray(itemsValue) ? itemsValue.length : undefined,
        dataKeys: Object.keys(fetchedData),
      })

      // Build data context based on mode
      // For both data and analysis modes, include all items (up to 50) so LLM can present them properly
      if (itemsValue && Array.isArray(itemsValue) && itemsValue.length > 0) {
        const totalItems = countValue ?? itemsValue.length
        const maxItemsToShow = 50 // Reasonable limit to avoid token explosion
        const itemsToShow = itemsValue.slice(0, maxItemsToShow)

        if (mode === "analysis" && countValue !== undefined) {
          dataContext = `\n## Query Result\n**Total Count: ${totalItems}**\n`
        } else {
          dataContext = `\n## Fetched Data (${itemsToShow.length} of ${totalItems} items)\n`
        }

        // Include all items up to the limit
        dataContext += `\n**Items:**\n${safeJson(itemsToShow, 8000)}\n`

        if (itemsValue.length > maxItemsToShow) {
          dataContext += `\n_Note: Showing first ${maxItemsToShow} of ${totalItems} total items._\n`
        }
      } else if (mode === "analysis" && countValue !== undefined) {
        // Count-only queries
        dataContext = `\n## Query Result\n**Total Count: ${countValue}**\n`
        if (fetchedData.message) {
          dataContext += `\n${fetchedData.message}\n`
        }
      } else {
        // Fallback - show full data
        dataContext = `\n## Fetched Data\n${safeJson(fetchedData, 8000)}\n`
      }
    }
    if (executionError) {
      dataContext += `\n## Execution Error\n${executionError}\n`
    }

    // Build system prompt
    const systemPrompt = buildV4SystemPrompt(mode, resolved, dataContext)

    // Build conversation
    const threadHistory = (context as any)?.threadHistory || []
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...threadHistory,
      { role: "user" as const, content: message },
    ]

    // Generate response with model rotation
    let reply = ""
    let usedModel = ""
    const responseModels = await getModelsForStep("response_generation", requestId)

    for (const modelId of responseModels) {
      try {
        await waitForRateLimit()
        pushStep("trying_model", { modelId })

        const openrouter = createOpenRouter({
          apiKey: process.env.OPENROUTER_API_KEY,
        })

        const result = await generateText({
          model: openrouter(modelId) as any,
          messages,
          maxTokens: 2000,
        })

        reply = result.text || ""
        usedModel = modelId
        markModelSuccess(modelId)

        pushStep("response_generated", { modelId, length: reply.length })
        break
      } catch (error) {
        log.warn("LLM generation failed", { model: modelId, error: String(error) })

        if (isRateLimitError(error)) {
          markModelRateLimited(modelId)
          await waitAfterRateLimit()
        }
      }
    }

    if (!reply) {
      reply = `I apologize, but I encountered an error generating a response. ${executionError || "Please try again."}`
      pushStep("all_models_failed")
    }

    return {
      reply,
      steps,
      threadId,
      resourceId,
      model: usedModel,
      mode,
      resolvedQuery: resolved,
      executionLogs,
    }
  },
})

/**
 * Build V4 system prompt
 */
function buildV4SystemPrompt(
  mode: string,
  resolved: ResolvedQuery | null,
  dataContext: string
): string {
  const hasError = dataContext.includes("## Execution Error")

  const lines = [
    "You are an AI assistant for a textile commerce platform built on Medusa.",
    "",
  ]

  if (resolved?.executionPlan?.length) {
    lines.push("## Query Resolution")
    lines.push(`Entity: ${resolved.targetEntity}`)
    lines.push(`Mode: ${resolved.mode}`)
    lines.push(`Confidence: ${(resolved.confidence * 100).toFixed(0)}%`)
    lines.push("")
  }

  if (dataContext) {
    lines.push(dataContext)
    lines.push("")
  }

  // Handle errors prominently
  if (hasError) {
    lines.push("## IMPORTANT: Error Handling")
    lines.push("An error occurred while executing the query. You MUST:")
    lines.push("1. Clearly acknowledge the error to the user")
    lines.push("2. Explain what went wrong in simple terms")
    lines.push("3. Suggest alternatives or ask the user to rephrase their request")
    lines.push("Do NOT pretend the query succeeded or make up data.")
    lines.push("")
  } else if (mode === "data") {
    lines.push("## Data Presentation Instructions")
    lines.push("Present ALL items from the fetched data in a clear, organized format.")
    lines.push("- Use a table or list format to show all items")
    lines.push("- Do NOT summarize or show only a few examples - show every item provided")
    lines.push("- Highlight key fields (ID, name, status) for each item")
    lines.push("- If there are many items, organize them logically but still show ALL of them")
  } else if (mode === "analysis") {
    lines.push("For count queries, use the **Total Count** value provided above - this is the accurate total.")
    lines.push("When listing items, show ALL items provided, not just a summary.")
    lines.push("Analyze the data and provide insights. Look for patterns and trends.")
  } else if (mode === "create" || mode === "update") {
    lines.push("Confirm the operation and explain what was done.")
  } else {
    lines.push("Have a helpful conversation with the user.")
  }

  lines.push("")
  lines.push("Keep responses concise. Use markdown for readability.")

  return lines.join("\n")
}

// ============================================
// STEP 4: Save to Memory
// ============================================

const saveToMemoryStep = createStep({
  id: "aiv4:save-to-memory",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async ({ inputData }) => {
    const { message, reply, threadId, resourceId, mode } = inputData

    if (!memory || !threadId) {
      return inputData
    }

    const finalResourceId = resourceId || "ai:v4"

    try {
      // Ensure thread exists
      let thread = null
      try {
        thread = await (memory as any).getThreadById?.({ threadId })
      } catch { /* Thread doesn't exist */ }

      if (!thread) {
        try {
          await (memory as any).createThread({
            threadId,
            resourceId: finalResourceId,
            title: message?.slice(0, 100) || "AI Chat V4",
            metadata: { source: "ai:v4:workflow" },
          })
        } catch { /* Continue anyway */ }
      }

      // Save messages
      const now = new Date()
      const messages = [
        {
          id: `msg_${Date.now()}_user`,
          role: "user",
          createdAt: now,
          threadId,
          resourceId: finalResourceId,
          type: "text",
          content: { format: 2, parts: [{ type: "text", text: message || "" }] },
        },
        {
          id: `msg_${Date.now()}_assistant`,
          role: "assistant",
          createdAt: new Date(now.getTime() + 1),
          threadId,
          resourceId: finalResourceId,
          type: "text",
          content: {
            format: 2,
            parts: [{ type: "text", text: reply || "" }],
            metadata: { mode },
          },
        },
      ]

      await (memory as any).saveMessages({ messages, format: "v2" })
      log.debug("Messages saved to memory", { threadId })
    } catch (error) {
      log.warn("Failed to save to memory", { error: String(error) })
    }

    return inputData
  },
})

// ============================================
// STEP 5: Learn from Result
// ============================================

const learnFromResultStep = createStep({
  id: "aiv4:learn-from-result",
  inputSchema: z.any(),
  outputSchema,
  execute: async ({ inputData }) => {
    const {
      reply,
      steps,
      threadId,
      resourceId,
      model,
      mode,
      resolvedQuery,
      queryPlanSuccess,
      executionLogs,
    } = inputData

    // V4 learning: the hybrid resolver already manages its indexed docs
    // Here we just log successful patterns for future optimization
    if (queryPlanSuccess && resolvedQuery?.source === "bm25_llm") {
      log.info("Successful BM25+LLM resolution - consider adding to indexed docs", {
        query: resolvedQuery.query?.slice(0, 50),
        entity: resolvedQuery.targetEntity,
        patterns: resolvedQuery.patterns?.slice(0, 3),
      })
      // Future: Auto-add to indexed docs after N successful uses
    }

    return {
      reply,
      steps,
      threadId,
      resourceId,
      model,
      mode,
      resolvedQuery,
      executionLogs,
    }
  },
})

// ============================================
// WORKFLOW DEFINITION
// ============================================

export const aiChatWorkflow = createWorkflow({
  id: "aiChatWorkflow",
  inputSchema,
  outputSchema,
})
  .then(resolveQueryStep)      // Step 1: Hybrid query resolution
  .then(executeActionStep)      // Step 2: Execute the plan
  .then(generateResponseStep)   // Step 3: Generate LLM response
  .then(saveToMemoryStep)       // Step 4: Persist conversation
  .then(learnFromResultStep)    // Step 5: Learn from success
  .commit()

export default aiChatWorkflow
