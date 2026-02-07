/**
 * Plan Executor (Enhanced - Phase 8)
 *
 * Executes multi-step query plans with evaluation and retry logic.
 * Key features:
 * - Entity classification awareness (Core vs Custom)
 * - Step-by-step evaluation
 * - Intelligent retry with filter broadening
 * - Rich debugging and logging
 */

import { MedusaContainer } from "@medusajs/framework"
import { executeServiceCall, ServiceCallArgs, AuthHeaders } from "./service-executor"
import { QueryPlan, enrichPlanWithClassification } from "./query-planner"
import { planExecutorLogger as log } from "../services/logger"
import {
  EnhancedQueryPlan,
  EnhancedQueryStep,
  ExecutionStep,
  EnhancedPlanExecutionResult,
  ServiceCallResult,
  DataLineage,
  EvaluationSummary,
  StepEvaluationResult,
  MAX_RETRIES,
} from "./types"
import {
  evaluateStepResult,
  extractItemsFromResult,
  applyRetryStrategy,
  calculateQualityScore,
} from "../services/step-evaluator"
import { getClassificationSummary } from "../services/entity-classifier"

// Re-export types for backward compatibility
export type { ExecutionStep, EnhancedPlanExecutionResult }

// Legacy type for backward compatibility
export interface PlanExecutionResult {
  success: boolean
  finalResult: ServiceCallResult | null
  executionSteps: ExecutionStep[]
  plan: QueryPlan
  error?: string
}

/**
 * Extract a value from service call result data
 *
 * @param data - The data from a service call result
 * @param fieldPath - The field to extract (e.g., "id", "name")
 * @param wrapperKey - Expected wrapper key for the response
 * @returns The extracted value, or undefined if not found
 */
function extractValueFromResult(data: any, fieldPath: string, wrapperKey?: string): any {
  if (!data) {
    log.debug("extractValueFromResult: data is null/undefined")
    return undefined
  }

  log.debug("extractValueFromResult: analyzing data", {
    dataType: typeof data,
    dataKeys: Object.keys(data || {}),
    wrapperKey,
  })

  // Use the step evaluator's extraction logic
  const items = extractItemsFromResult(data, wrapperKey)

  if (items.length === 0) {
    log.debug("extractValueFromResult: no items found")
    return undefined
  }

  // Extract the field from the first item
  const firstItem = items[0]
  log.debug("extractValueFromResult: first item", { keys: Object.keys(firstItem || {}) })

  if (firstItem && fieldPath in firstItem) {
    const value = firstItem[fieldPath]
    log.debug("extractValueFromResult: extracted value", { field: fieldPath, value })
    return value
  }

  log.debug("extractValueFromResult: field not found", { field: fieldPath })
  return undefined
}

/**
 * Substitute $N references in filters with actual values
 *
 * @param filters - Original filters with $N references
 * @param stepResults - Map of step number to resolved values
 * @returns Filters with references substituted
 */
function substituteReferences(
  filters: Record<string, any>,
  stepResults: Map<number, any>
): Record<string, any> {
  const resolved: Record<string, any> = {}

  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value.startsWith("$")) {
      // Parse reference like "$1" or "$1.id"
      const match = value.match(/^\$(\d+)(?:\.(\w+))?$/)
      if (match) {
        const stepNum = parseInt(match[1], 10)
        const resolvedValue = stepResults.get(stepNum)

        if (resolvedValue !== undefined) {
          resolved[key] = resolvedValue
          log.debug("Substituted reference", { reference: value, resolvedTo: resolvedValue })
        } else {
          log.warn("Reference not found in step results", {
            reference: value,
            availableSteps: Array.from(stepResults.keys()),
          })
          // Keep the original value if reference not found
          resolved[key] = value
        }
      } else {
        resolved[key] = value
      }
    } else {
      resolved[key] = value
    }
  }

  return resolved
}

/**
 * Execute an enhanced query plan with evaluation and retry logic
 *
 * @param container - Medusa container for service calls
 * @param plan - The enhanced query plan to execute
 * @param authHeaders - Optional auth headers for API calls
 * @returns Enhanced execution result with evaluation metadata
 */
export async function executeEnhancedQueryPlan(
  container: MedusaContainer,
  plan: EnhancedQueryPlan,
  authHeaders?: AuthHeaders
): Promise<EnhancedPlanExecutionResult> {
  const startTime = Date.now()
  const executionSteps: ExecutionStep[] = []
  const stepResults = new Map<number, any>()
  const dataLineage: DataLineage[] = []
  const evaluationSummary: EvaluationSummary = {
    successful: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
  }

  log.header("EXECUTING ENHANCED QUERY PLAN")
  log.info("Plan overview", {
    steps: plan.steps.length,
    explanation: plan.explanation,
    coreEntities: plan.coreEntitiesInvolved.length > 0 ? plan.coreEntitiesInvolved : "(none)",
    customEntities: plan.customEntitiesInvolved.length > 0 ? plan.customEntitiesInvolved : "(none)",
  })

  for (const step of plan.steps) {
    const stepStartTime = Date.now()

    // Pre-execution logging
    log.separator("─")
    log.step(step.step, plan.steps.length, step.description, {
      entity: step.entity,
      type: step.classification.isCore ? "CORE" : "CUSTOM",
      method: getClassificationSummary(step.classification),
      dependsOn: step.dependsOn.length > 0 ? step.dependsOn : undefined,
    })

    let attempt = 0
    let currentFilters = { ...step.filters }
    let lastResult: ServiceCallResult | null = null
    let lastEvaluation: StepEvaluationResult | null = null
    let extractedValue: any

    while (attempt < MAX_RETRIES + 1) {
      attempt++

      try {
        // Substitute $N references from previous steps
        const resolvedFilters = substituteReferences(currentFilters, stepResults)

        log.debug("Step attempt", {
          step: step.step,
          attempt,
          maxAttempts: MAX_RETRIES + 1,
          filters: resolvedFilters,
        })

        // Extract pagination options from filters (LLM might put them there incorrectly)
        const { limit, take, offset, skip, ...actualFilters } = resolvedFilters
        const takeValue = limit || take || 10 // Extract limit/take from filters, default to 10
        const skipValue = offset || skip || 0

        // Build service call args
        const serviceArgs: ServiceCallArgs = {
          entity: step.entity,
          method: step.operation,
          filters: Object.keys(actualFilters).length > 0 ? actualFilters : undefined,
          config: {
            relations: step.relations,
            take: takeValue,
            skip: skipValue,
          },
        }

        // Execute the service call
        lastResult = await executeServiceCall(container, serviceArgs, authHeaders)

        log.info("API Response", {
          step: step.step,
          success: lastResult.success,
          error: lastResult.success ? undefined : lastResult.error,
        })

        // Extract value if specified
        extractedValue = undefined
        if (step.extract && lastResult.success && lastResult.data) {
          extractedValue = extractValueFromResult(
            lastResult.data,
            step.extract,
            step.responseExpectation.wrapperKey
          )
          log.debug("Extracted value from result", {
            step: step.step,
            field: step.extract,
            value: extractedValue,
          })
        }

        // EVALUATE the step result
        const evaluation = await evaluateStepResult(step, lastResult, extractedValue)
        lastEvaluation = evaluation

        log.info("Step evaluation", {
          step: step.step,
          quality: evaluation.dataQuality.toUpperCase(),
          summary: evaluation.summary,
          recommendation: evaluation.recommendation,
        })

        // Handle evaluation recommendation
        if (evaluation.recommendation === "continue") {
          // Success - store value and break retry loop
          if (extractedValue !== undefined) {
            stepResults.set(step.step, extractedValue)
            dataLineage.push({
              stepNumber: step.step,
              entity: step.entity,
              extractedField: step.extract,
              extractedValue,
            })
          }
          evaluationSummary.successful++
          if (attempt > 1) {
            evaluationSummary.retried++
          }
          break
        }

        if (evaluation.recommendation === "retry" && attempt < MAX_RETRIES + 1) {
          // Apply retry strategy
          if (evaluation.retryStrategy) {
            currentFilters = applyRetryStrategy(currentFilters, evaluation.retryStrategy)
            log.debug("Retrying with adjusted filters", {
              step: step.step,
              newFilters: currentFilters,
            })
          }
          evaluationSummary.retried++
          continue
        }

        if (evaluation.recommendation === "abort") {
          // Critical failure - abort execution
          log.error("Step ABORTING", {
            step: step.step,
            reason: evaluation.error?.message,
          })
          evaluationSummary.failed++

          executionSteps.push({
            step: step.step,
            entity: step.entity,
            operation: step.operation,
            filters: resolvedFilters,
            result: lastResult,
            resolvedValue: extractedValue,
            evaluation,
            attempts: attempt,
            durationMs: Date.now() - stepStartTime,
          })

          return {
            success: false,
            finalResult: null,
            executionSteps,
            plan,
            qualityScore: calculateQualityScore(executionSteps.map((s) => s.evaluation!).filter(Boolean)),
            evaluationSummary,
            dataLineage,
            error: `Step ${step.step} failed: ${evaluation.error?.message}`,
            totalDurationMs: Date.now() - startTime,
          }
        }

        if (evaluation.recommendation === "skip") {
          evaluationSummary.skipped++
          break
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log.error("Step exception", { step: step.step, error: errorMessage })

        lastResult = {
          success: false,
          error: errorMessage,
          entity: step.entity,
          method: step.operation,
        }

        // For intermediate steps, abort on exception
        if (step.step < plan.steps.length) {
          evaluationSummary.failed++

          executionSteps.push({
            step: step.step,
            entity: step.entity,
            operation: step.operation,
            filters: currentFilters,
            result: lastResult,
            attempts: attempt,
            durationMs: Date.now() - stepStartTime,
          })

          return {
            success: false,
            finalResult: null,
            executionSteps,
            plan,
            qualityScore: 0,
            evaluationSummary,
            dataLineage,
            error: `Step ${step.step} failed: ${errorMessage}`,
            totalDurationMs: Date.now() - startTime,
          }
        }
      }
    }

    // Record final step execution
    executionSteps.push({
      step: step.step,
      entity: step.entity,
      operation: step.operation,
      filters: substituteReferences(currentFilters, stepResults),
      result: lastResult!,
      resolvedValue: extractedValue,
      evaluation: lastEvaluation || undefined,
      attempts: attempt,
      durationMs: Date.now() - stepStartTime,
    })
  }

  // Calculate overall quality score
  const evaluations = executionSteps.map((s) => s.evaluation).filter(Boolean)
  const qualityScore = calculateQualityScore(evaluations as any[])

  // Get the final step result
  const finalStep = executionSteps[executionSteps.length - 1]
  const success = finalStep?.result?.success ?? false

  const totalDurationMs = Date.now() - startTime

  log.header("EXECUTION COMPLETE")
  log.info("Execution summary", {
    success,
    qualityScore: `${qualityScore}/100`,
    durationMs: totalDurationMs,
    steps: {
      successful: evaluationSummary.successful,
      failed: evaluationSummary.failed,
      retried: evaluationSummary.retried,
      skipped: evaluationSummary.skipped,
    },
  })

  return {
    success,
    finalResult: finalStep?.result || null,
    executionSteps,
    plan,
    qualityScore,
    evaluationSummary,
    dataLineage,
    totalDurationMs,
  }
}

/**
 * Execute a basic query plan (legacy compatibility)
 *
 * This function maintains backward compatibility with the old API
 * while internally using the enhanced execution.
 */
export async function executeQueryPlan(
  container: MedusaContainer,
  plan: QueryPlan,
  authHeaders?: AuthHeaders
): Promise<PlanExecutionResult> {
  // Enrich the plan with classification
  const enhancedPlan = enrichPlanWithClassification(plan)

  // Execute with enhanced logic
  const enhancedResult = await executeEnhancedQueryPlan(container, enhancedPlan, authHeaders)

  // Convert to legacy format
  return {
    success: enhancedResult.success,
    finalResult: enhancedResult.finalResult,
    executionSteps: enhancedResult.executionSteps,
    plan,
    error: enhancedResult.error,
  }
}

/**
 * Format plan execution result for LLM context
 */
export function formatExecutionForLLM(result: PlanExecutionResult | EnhancedPlanExecutionResult): string {
  const lines: string[] = []

  // Add plan explanation
  lines.push(`## Query Plan: ${result.plan.explanation}`)
  lines.push("")

  // Add quality score if available
  if ("qualityScore" in result) {
    lines.push(`**Quality Score:** ${result.qualityScore}/100`)
    lines.push("")
  }

  // Add execution steps
  if (result.executionSteps.length > 1) {
    lines.push("### Resolution Steps:")
    for (const step of result.executionSteps.slice(0, -1)) {
      const evalInfo = step.evaluation
        ? ` [${step.evaluation.dataQuality}]`
        : ""
      if (step.resolvedValue) {
        lines.push(`- Step ${step.step}: Found ${step.entity}${evalInfo} → ${step.resolvedValue}`)
      } else if (!step.result.success) {
        lines.push(`- Step ${step.step}: Failed to find ${step.entity}${evalInfo} - ${step.result.error}`)
      }
    }
    lines.push("")
  }

  // Add final result
  if (result.finalResult) {
    lines.push(`### Results (${result.plan.finalEntity}):`)

    if (!result.finalResult.success) {
      lines.push(`Error: ${result.finalResult.error}`)
    } else if (result.finalResult.data) {
      const data = result.finalResult.data

      // Extract array from response
      const items = extractItemsFromResult(data, undefined)

      if (items.length === 0) {
        lines.push("No results found.")
      } else {
        lines.push(`Found ${items.length} item(s):`)
        for (const item of items.slice(0, 10)) {
          const preview = buildItemPreview(item)
          lines.push(`- ${preview}`)
        }
        if (items.length > 10) {
          lines.push(`... and ${items.length - 10} more`)
        }
      }
    }
  } else if (!result.success) {
    lines.push(`### Error:`)
    lines.push(result.error || "Unknown error occurred")
  }

  return lines.join("\n")
}

/**
 * Format enhanced execution result with detailed debugging info
 */
export function formatEnhancedExecutionForDebug(result: EnhancedPlanExecutionResult): string {
  const lines: string[] = []

  lines.push("# Enhanced Execution Report")
  lines.push("")
  lines.push(`**Plan:** ${result.plan.explanation}`)
  lines.push(`**Success:** ${result.success}`)
  lines.push(`**Quality Score:** ${result.qualityScore}/100`)
  lines.push(`**Duration:** ${result.totalDurationMs}ms`)
  lines.push("")

  lines.push("## Execution Summary")
  lines.push(`- Successful steps: ${result.evaluationSummary.successful}`)
  lines.push(`- Failed steps: ${result.evaluationSummary.failed}`)
  lines.push(`- Retried steps: ${result.evaluationSummary.retried}`)
  lines.push(`- Skipped steps: ${result.evaluationSummary.skipped}`)
  lines.push("")

  lines.push("## Data Lineage")
  for (const lineage of result.dataLineage) {
    lines.push(`- Step ${lineage.stepNumber} (${lineage.entity}): ${lineage.extractedField} = ${lineage.extractedValue}`)
  }
  lines.push("")

  lines.push("## Step Details")
  for (const step of result.executionSteps) {
    lines.push("")
    lines.push(`### Step ${step.step}: ${step.entity}`)
    lines.push(`- Operation: ${step.operation}`)
    lines.push(`- Filters: ${JSON.stringify(step.filters)}`)
    lines.push(`- Attempts: ${step.attempts}`)
    lines.push(`- Duration: ${step.durationMs}ms`)
    lines.push(`- Success: ${step.result.success}`)
    if (step.evaluation) {
      lines.push(`- Quality: ${step.evaluation.dataQuality}`)
      lines.push(`- Summary: ${step.evaluation.summary}`)
    }
    if (step.resolvedValue !== undefined) {
      lines.push(`- Extracted: ${step.resolvedValue}`)
    }
    if (step.result.error) {
      lines.push(`- Error: ${step.result.error}`)
    }
  }

  return lines.join("\n")
}

/**
 * Build a preview string for an item
 */
function buildItemPreview(item: any): string {
  if (!item) return "(empty)"

  const parts: string[] = []

  // Primary identifiers
  if (item.id) parts.push(`id: ${item.id}`)

  // Name fields (multiple formats)
  if (item.name) parts.push(`name: ${item.name}`)
  if (item.first_name || item.last_name) {
    parts.push(`name: ${item.first_name || ""} ${item.last_name || ""}`.trim())
  }

  // Common descriptive fields
  if (item.title) parts.push(`title: ${item.title}`)
  if (item.label) parts.push(`label: ${item.label}`)
  if (item.description) parts.push(`description: ${item.description}`)
  if (item.value) parts.push(`value: ${item.value}`)
  if (item.code) parts.push(`code: ${item.code}`)

  // Product/inventory fields
  if (item.handle) parts.push(`handle: ${item.handle}`)
  if (item.sku) parts.push(`sku: ${item.sku}`)

  // Status/state fields
  if (item.status) parts.push(`status: ${item.status}`)
  if (item.is_active !== undefined) parts.push(`active: ${item.is_active}`)

  // Contact fields
  if (item.email) parts.push(`email: ${item.email}`)

  // Order/transaction fields
  if (item.display_id) parts.push(`display_id: ${item.display_id}`)
  if (item.total) parts.push(`total: ${item.total}`)
  if (item.currency_code) parts.push(`currency: ${item.currency_code}`)

  // Metadata
  if (item.created_at) parts.push(`created: ${item.created_at}`)

  // If we have parts, join them; otherwise show a truncated JSON preview
  return parts.length > 0 ? parts.join(", ") : JSON.stringify(item).slice(0, 150)
}
