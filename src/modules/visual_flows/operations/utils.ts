import { DataChain } from "./types"

/**
 * Interpolate variables in a string using the data chain
 * Supports syntax like {{ $trigger.payload.email }} or {{ operation_key.result.id }}
 */
export function interpolateString(template: string, dataChain: DataChain): string {
  if (typeof template !== "string") return template
  
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match, path) => {
    const value = getValueByPath(dataChain, path.trim())
    if (value === undefined || value === null) return ""
    if (typeof value === "object") return JSON.stringify(value)
    return String(value)
  })
}

/**
 * Recursively interpolate variables in an object
 */
export function interpolateVariables(obj: any, dataChain: DataChain): any {
  if (obj === null || obj === undefined) return obj
  
  if (typeof obj === "string") {
    // Check if the entire string is a variable reference
    const fullMatch = obj.match(/^\{\{\s*([^}]+)\s*\}\}$/)
    if (fullMatch) {
      // Return the actual value (preserving type)
      return getValueByPath(dataChain, fullMatch[1].trim())
    }
    // Otherwise interpolate as string
    return interpolateString(obj, dataChain)
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => interpolateVariables(item, dataChain))
  }
  
  if (typeof obj === "object") {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateVariables(value, dataChain)
    }
    return result
  }
  
  return obj
}

/**
 * Get a value from an object by dot-notation path
 * Supports array indexing like "items[0].name"
 */
export function getValueByPath(obj: any, path: string): any {
  if (!path) return obj
  
  const parts = path.split(/\.|\[|\]/).filter(Boolean)
  let current = obj
  
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = current[part]
  }
  
  return current
}

/**
 * Set a value in an object by dot-notation path
 */
export function setValueByPath(obj: any, path: string, value: any): void {
  const parts = path.split(".")
  let current = obj
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current)) {
      current[part] = {}
    }
    current = current[part]
  }
  
  current[parts[parts.length - 1]] = value
}

/**
 * Evaluate a filter rule against data
 * Supports operators: _eq, _neq, _gt, _gte, _lt, _lte, _in, _nin, _contains, _starts_with, _ends_with
 */
export function evaluateFilterRule(rule: Record<string, any>, data: any): boolean {
  for (const [key, condition] of Object.entries(rule)) {
    // Handle logical operators
    if (key === "_and") {
      if (!Array.isArray(condition)) return false
      return condition.every(subRule => evaluateFilterRule(subRule, data))
    }
    
    if (key === "_or") {
      if (!Array.isArray(condition)) return false
      return condition.some(subRule => evaluateFilterRule(subRule, data))
    }
    
    if (key === "_not") {
      return !evaluateFilterRule(condition, data)
    }
    
    // Get the value to compare
    const value = getValueByPath(data, key)
    
    // Handle comparison operators
    if (typeof condition === "object" && condition !== null) {
      for (const [op, expected] of Object.entries(condition)) {
        if (!evaluateOperator(op, value, expected)) return false
      }
    } else {
      // Direct equality
      if (value !== condition) return false
    }
  }
  
  return true
}

function evaluateOperator(operator: string, value: any, expected: any): boolean {
  switch (operator) {
    case "_eq":
      return value === expected
    case "_neq":
      return value !== expected
    case "_gt":
      return value > expected
    case "_gte":
      return value >= expected
    case "_lt":
      return value < expected
    case "_lte":
      return value <= expected
    case "_in":
      return Array.isArray(expected) && expected.includes(value)
    case "_nin":
      return Array.isArray(expected) && !expected.includes(value)
    case "_contains":
      return typeof value === "string" && value.includes(expected)
    case "_starts_with":
      return typeof value === "string" && value.startsWith(expected)
    case "_ends_with":
      return typeof value === "string" && value.endsWith(expected)
    case "_null":
      return expected ? value === null || value === undefined : value !== null && value !== undefined
    case "_empty":
      return expected 
        ? value === "" || value === null || value === undefined || (Array.isArray(value) && value.length === 0)
        : value !== "" && value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)
    default:
      return true
  }
}

/**
 * Get allowed environment variables
 */
export function getAllowedEnvVars(allowList: string[] = []): Record<string, string> {
  const result: Record<string, string> = {}
  
  // Default allowed vars
  const defaultAllowed = ["NODE_ENV", "PUBLIC_URL"]
  const allowed = [...defaultAllowed, ...allowList]
  
  for (const key of allowed) {
    if (process.env[key]) {
      result[key] = process.env[key]!
    }
  }
  
  return result
}
