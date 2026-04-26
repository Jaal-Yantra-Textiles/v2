/**
 * Step Evaluator Service
 *
 * Evaluates the result of each query step to determine:
 * - Data quality (excellent, good, acceptable, poor, failed)
 * - Whether to continue, retry, or abort
 * - Retry strategies when results are poor
 */

import {
  EnhancedQueryStep,
  ServiceCallResult,
  StepEvaluationResult,
  DataQuality,
  EvaluationRecommendation,
  StepErrorCode,
  RetryStrategy,
  StepValidation,
} from "../tools/types"

/**
 * Evaluate the result of a query step
 *
 * @param step - The enhanced query step with validation criteria
 * @param result - The service call result
 * @param extractedValue - The value extracted for use in subsequent steps
 * @returns Evaluation result with recommendation
 */
export async function evaluateStepResult(
  step: EnhancedQueryStep,
  result: ServiceCallResult,
  extractedValue: any | undefined
): Promise<StepEvaluationResult> {
  // Extract items from the result for evaluation
  const items = extractItemsFromResult(result.data, step.responseExpectation.wrapperKey)

  const criteria = {
    hasResults: items.length > 0,
    resultCount: items.length,
    requiredFieldsPresent: checkRequiredFields(items, step.validation.requireFields),
    extractedValueValid: validateExtractedValue(extractedValue, step.validation),
  }

  console.log(`[StepEvaluator] Step ${step.step} evaluation criteria:`, criteria)

  // Check for API errors first
  if (!result.success) {
    return buildErrorResult(
      "API_ERROR",
      result.error || "Unknown API error",
      criteria,
      determineRetryForApiError(result)
    )
  }

  // Check if results are required but missing
  if (step.validation.requireNonEmpty && !criteria.hasResults) {
    return buildNoResultsResult(step, criteria)
  }

  // Check if extraction was required but failed
  if (step.extract && !criteria.extractedValueValid) {
    return buildExtractionFailedResult(step, criteria)
  }

  // Check required fields
  if (!criteria.requiredFieldsPresent && criteria.hasResults) {
    return {
      success: false,
      dataQuality: "poor",
      evaluatedCriteria: criteria,
      recommendation: "continue", // Continue but with warning
      error: {
        code: "VALIDATION_FAILED",
        message: `Missing required fields in ${step.entity} results`,
      },
      summary: `Found ${criteria.resultCount} ${step.entity}(s) but missing some required fields`,
    }
  }

  // Success - determine quality level
  const dataQuality = determineDataQuality(criteria, step)

  return {
    success: true,
    dataQuality,
    evaluatedCriteria: criteria,
    recommendation: "continue",
    summary: buildSuccessSummary(step, criteria),
  }
}

/**
 * Extract items array from service call result data
 *
 * Handles different response formats:
 * - Direct array: [...]
 * - Medusa wrapped: { customers: [...] }
 * - Single object: { id: "...", ... }
 *
 * @param data - The result data
 * @param wrapperKey - Expected wrapper key for Medusa responses
 * @returns Array of items
 */
export function extractItemsFromResult(data: any, wrapperKey?: string): any[] {
  if (!data) {
    console.log("[StepEvaluator] extractItemsFromResult: data is null/undefined")
    return []
  }

  console.log("[StepEvaluator] extractItemsFromResult: data type:", typeof data)
  console.log("[StepEvaluator] extractItemsFromResult: wrapper key:", wrapperKey)

  // If data is already an array, return it
  if (Array.isArray(data)) {
    console.log("[StepEvaluator] extractItemsFromResult: data is direct array with", data.length, "items")
    return data
  }

  // Log available keys for debugging
  if (typeof data === "object") {
    console.log("[StepEvaluator] extractItemsFromResult: data keys:", Object.keys(data))
  }

  // Check for expected wrapper key first
  if (wrapperKey && data[wrapperKey] && Array.isArray(data[wrapperKey])) {
    console.log(
      `[StepEvaluator] extractItemsFromResult: found ${data[wrapperKey].length} items in '${wrapperKey}'`
    )
    return data[wrapperKey]
  }

  // Try to find any array in the response
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key])) {
      console.log(
        `[StepEvaluator] extractItemsFromResult: found ${data[key].length} items in '${key}'`
      )
      return data[key]
    }
  }

  // If data is a single object with an id, treat it as single item
  if (typeof data === "object" && data.id) {
    console.log("[StepEvaluator] extractItemsFromResult: treating single object as item")
    return [data]
  }

  console.log("[StepEvaluator] extractItemsFromResult: no items found")
  return []
}

/**
 * Check if required fields are present in all items
 */
function checkRequiredFields(items: any[], requiredFields: string[]): boolean {
  if (items.length === 0 || requiredFields.length === 0) {
    return true
  }

  return items.every((item) =>
    requiredFields.every((field) => item && field in item && item[field] !== undefined)
  )
}

/**
 * Validate the extracted value against validation criteria
 */
function validateExtractedValue(value: any, validation: StepValidation): boolean {
  if (!validation.extractField) {
    return true // No extraction required
  }

  if (value === undefined || value === null) {
    console.log("[StepEvaluator] validateExtractedValue: value is null/undefined")
    return false
  }

  const extractValidation = validation.extractValidation
  if (!extractValidation) {
    return true // No specific validation rules
  }

  if (extractValidation.notNull && value === null) {
    return false
  }

  if (extractValidation.type) {
    const actualType = typeof value
    if (extractValidation.type === "string" && actualType !== "string") {
      console.log(
        `[StepEvaluator] validateExtractedValue: expected string, got ${actualType}`
      )
      return false
    }
    if (extractValidation.type === "number" && actualType !== "number") {
      console.log(
        `[StepEvaluator] validateExtractedValue: expected number, got ${actualType}`
      )
      return false
    }
  }

  return true
}

/**
 * Determine data quality based on evaluation criteria
 */
function determineDataQuality(
  criteria: StepEvaluationResult["evaluatedCriteria"],
  step: EnhancedQueryStep
): DataQuality {
  if (!criteria.hasResults) {
    return "poor"
  }

  // Multiple results when we only need one for extraction
  if (step.extract && criteria.resultCount > 1) {
    return "acceptable" // Multiple matches, might not be exact
  }

  // All criteria met with good result count
  if (criteria.requiredFieldsPresent && criteria.extractedValueValid) {
    return criteria.resultCount === 1 ? "excellent" : "good"
  }

  return "acceptable"
}

/**
 * Build error result for API failures
 */
function buildErrorResult(
  code: StepErrorCode,
  message: string,
  criteria: StepEvaluationResult["evaluatedCriteria"],
  retryStrategy?: RetryStrategy
): StepEvaluationResult {
  return {
    success: false,
    dataQuality: "failed",
    evaluatedCriteria: criteria,
    recommendation: retryStrategy ? "retry" : "abort",
    retryStrategy,
    error: { code, message },
    summary: `API call failed: ${message}`,
  }
}

/**
 * Build result for no results found
 */
function buildNoResultsResult(
  step: EnhancedQueryStep,
  criteria: StepEvaluationResult["evaluatedCriteria"]
): StepEvaluationResult {
  // First step failing with no results is more critical
  const isFirstStep = step.step === 1
  const recommendation: EvaluationRecommendation = isFirstStep ? "retry" : "retry"

  // Build retry strategy - broaden the search
  const retryStrategy: RetryStrategy = {
    broaderSearch: true,
  }

  // If there's a "q" filter, we can try to shorten it
  if (step.filters.q && typeof step.filters.q === "string") {
    const words = step.filters.q.split(" ")
    if (words.length > 1) {
      retryStrategy.adjustFilters = {
        q: words[0], // Use just the first word
      }
    }
  }

  return {
    success: false,
    dataQuality: "poor",
    evaluatedCriteria: criteria,
    recommendation,
    retryStrategy,
    error: {
      code: "NO_RESULTS",
      message: `No ${step.entity} found matching filters`,
    },
    summary: `No ${step.entity} found matching filters`,
  }
}

/**
 * Build result for extraction failures
 */
function buildExtractionFailedResult(
  step: EnhancedQueryStep,
  criteria: StepEvaluationResult["evaluatedCriteria"]
): StepEvaluationResult {
  return {
    success: false,
    dataQuality: "poor",
    evaluatedCriteria: criteria,
    recommendation: "abort", // Can't continue without extracted value
    error: {
      code: "EXTRACTION_FAILED",
      message: `Could not extract '${step.extract}' from ${step.entity}`,
    },
    summary: `Failed to extract ${step.extract} from ${step.entity}`,
  }
}

/**
 * Determine retry strategy for API errors
 */
function determineRetryForApiError(result: ServiceCallResult): RetryStrategy | undefined {
  // Don't retry on 4xx errors (except 429 rate limit)
  if (result.statusCode && result.statusCode >= 400 && result.statusCode < 500) {
    if (result.statusCode === 429) {
      return {} // Retry without changes, just wait
    }
    return undefined // Don't retry client errors
  }

  // Retry on 5xx errors
  if (result.statusCode && result.statusCode >= 500) {
    return {} // Simple retry
  }

  // Retry on unknown errors (network issues, etc.)
  return {}
}

/**
 * Build success summary message
 */
function buildSuccessSummary(
  step: EnhancedQueryStep,
  criteria: StepEvaluationResult["evaluatedCriteria"]
): string {
  const countDesc = criteria.resultCount === 1 ? "1 item" : `${criteria.resultCount} items`
  return `Found ${countDesc} for ${step.entity}`
}

/**
 * Apply retry strategy to filters
 *
 * @param originalFilters - Original step filters
 * @param strategy - Retry strategy to apply
 * @returns Modified filters for retry
 */
export function applyRetryStrategy(
  originalFilters: Record<string, any>,
  strategy: RetryStrategy
): Record<string, any> {
  let newFilters = { ...originalFilters }

  // Apply specific filter adjustments
  if (strategy.adjustFilters) {
    newFilters = { ...newFilters, ...strategy.adjustFilters }
  }

  // Remove specified filters
  if (strategy.removeFilters) {
    for (const filterToRemove of strategy.removeFilters) {
      delete newFilters[filterToRemove]
    }
  }

  // Broaden search by shortening "q" parameter
  if (strategy.broaderSearch && newFilters.q && typeof newFilters.q === "string") {
    const words = newFilters.q.split(" ")
    if (words.length > 1) {
      newFilters.q = words[0] // Use just the first word
      console.log(`[StepEvaluator] Broadened search: "${originalFilters.q}" → "${newFilters.q}"`)
    }
  }

  return newFilters
}

/**
 * Calculate overall quality score for a plan execution
 *
 * @param evaluations - Array of step evaluations
 * @returns Score from 0-100
 */
export function calculateQualityScore(evaluations: StepEvaluationResult[]): number {
  if (evaluations.length === 0) {
    return 0
  }

  const qualityScores: Record<DataQuality, number> = {
    excellent: 100,
    good: 80,
    acceptable: 60,
    poor: 30,
    failed: 0,
  }

  const totalScore = evaluations.reduce((sum, evaluation) => {
    return sum + qualityScores[evaluation.dataQuality]
  }, 0)

  return Math.round(totalScore / evaluations.length)
}
