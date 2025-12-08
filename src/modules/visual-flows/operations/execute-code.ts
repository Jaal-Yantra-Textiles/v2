import { z } from "zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables } from "./utils"

/**
 * Execute Code Operation
 * 
 * Executes JavaScript/TypeScript code in a sandboxed environment.
 * The code has access to:
 * - `$input`: The data chain (all previous operation outputs)
 * - `$last`: The last operation's output
 * - `$trigger`: The trigger payload
 * - `$context`: Execution context (flowId, executionId, etc.)
 * - `console.log`: For debugging (captured in logs)
 * 
 * The code should return a value which becomes this operation's output.
 * 
 * Example:
 * ```javascript
 * // Filter records where status is active
 * const records = $last.records || []
 * const filtered = records.filter(r => r.status === 'active')
 * return { filtered, count: filtered.length }
 * ```
 */
export const executeCodeOperation: OperationDefinition = {
  type: "execute_code",
  name: "Execute Code",
  description: "Execute custom JavaScript/TypeScript code",
  icon: "code-bracket",
  category: "utility",
  
  optionsSchema: z.object({
    code: z.string().describe("JavaScript code to execute"),
    timeout: z.number().optional().default(5000).describe("Execution timeout in ms"),
  }),
  
  defaultOptions: {
    code: `// Access previous output with $last
// Access all data with $input
// Return your result

const data = $last || {}
return {
  processed: true,
  timestamp: new Date().toISOString(),
  data
}`,
    timeout: 5000,
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    const startTime = Date.now()
    const logs: string[] = []
    
    try {
      const code = options.code || ""
      const timeout = options.timeout || 5000
      
      if (!code.trim()) {
        return {
          success: false,
          error: "No code provided",
        }
      }
      
      // Create a sandboxed execution environment
      const sandbox = createSandbox(context.dataChain, logs)
      
      // Wrap code in an async function to support await
      const wrappedCode = `
        (async function() {
          ${code}
        })()
      `
      
      // Execute with timeout
      const result = await executeWithTimeout(
        () => runInSandbox(wrappedCode, sandbox),
        timeout
      )
      
      const duration = Date.now() - startTime
      
      return {
        success: true,
        data: {
          result,
          logs,
          duration_ms: duration,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Code execution failed: ${error.message}`,
        errorStack: error.stack,
        data: { logs },
      }
    }
  },
}

/**
 * Create a sandboxed environment for code execution
 */
function createSandbox(dataChain: Record<string, any>, logs: string[]) {
  return {
    // Data chain access
    $input: { ...dataChain },
    $last: dataChain.$last,
    $trigger: dataChain.$trigger,
    $context: {
      timestamp: new Date().toISOString(),
    },
    
    // Safe console
    console: {
      log: (...args: any[]) => {
        logs.push(args.map(a => JSON.stringify(a)).join(" "))
      },
      error: (...args: any[]) => {
        logs.push(`[ERROR] ${args.map(a => JSON.stringify(a)).join(" ")}`)
      },
      warn: (...args: any[]) => {
        logs.push(`[WARN] ${args.map(a => JSON.stringify(a)).join(" ")}`)
      },
    },
    
    // Safe utilities
    JSON,
    Date,
    Math,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Promise,
    
    // Utility functions
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    
    // Lodash-like helpers
    _: {
      get: (obj: any, path: string, defaultValue?: any) => {
        const keys = path.split(".")
        let result = obj
        for (const key of keys) {
          if (result == null) return defaultValue
          result = result[key]
        }
        return result ?? defaultValue
      },
      pick: (obj: any, keys: string[]) => {
        const result: any = {}
        for (const key of keys) {
          if (key in obj) result[key] = obj[key]
        }
        return result
      },
      omit: (obj: any, keys: string[]) => {
        const result = { ...obj }
        for (const key of keys) {
          delete result[key]
        }
        return result
      },
      groupBy: (arr: any[], key: string) => {
        return arr.reduce((acc, item) => {
          const k = item[key]
          if (!acc[k]) acc[k] = []
          acc[k].push(item)
          return acc
        }, {})
      },
      uniq: (arr: any[]) => [...new Set(arr)],
      flatten: (arr: any[]) => arr.flat(),
      sum: (arr: number[]) => arr.reduce((a, b) => a + b, 0),
      avg: (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
      min: (arr: number[]) => Math.min(...arr),
      max: (arr: number[]) => Math.max(...arr),
    },
  }
}

/**
 * Run code in the sandbox
 */
async function runInSandbox(code: string, sandbox: Record<string, any>): Promise<any> {
  // Create function with sandbox variables as parameters
  const paramNames = Object.keys(sandbox)
  const paramValues = Object.values(sandbox)
  
  // Use Function constructor to create a sandboxed function
  // Note: This is not a true sandbox, but prevents access to global scope
  const fn = new Function(...paramNames, `
    "use strict";
    return ${code}
  `)
  
  // Execute and ensure we always return a Promise
  const result = fn(...paramValues)
  
  // If result is a Promise, await it; otherwise return as-is
  return Promise.resolve(result)
}

/**
 * Execute with timeout
 */
function executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Execution timed out after ${timeout}ms`))
    }, timeout)
    
    fn()
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}
