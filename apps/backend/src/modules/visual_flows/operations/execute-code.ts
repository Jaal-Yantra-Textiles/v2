import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { getValueByPath } from "./utils"
import { loadPackage } from "./package-loader"
import { isIsolatedVmEnabled, runInIsolate } from "./isolated-runner"

// Import npm packages to expose in sandbox
import lodash from "lodash"
import dayjs from "dayjs"
import validator from "validator"
import * as crypto from "crypto"

/**
 * Blocked packages that should never be loaded (security)
 */
const BLOCKED_PACKAGES = new Set([
  "child_process",
  "fs",
  "path",
  "os",
  "net",
  "http",
  "https",
  "cluster",
  "worker_threads",
  "vm",
  "repl",
  "readline",
  "process",
  "module",
  "require",
])

/**
 * Built-in sandbox variables that are always available
 */
const BUILTIN_SANDBOX_VARS = new Set([
  // Data access
  "$input", "$last", "$trigger", "$context",
  // Console
  "console",
  // Built-in JS
  "JSON", "Date", "Math", "Array", "Object", "String", "Number", "Boolean",
  "RegExp", "Map", "Set", "Promise", "Error", "TypeError", "ReferenceError",
  // Utility functions
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", 
  "decodeURIComponent", "btoa", "atob", "setTimeout", "clearTimeout",
  // Built-in packages
  "_", "lodash", "dayjs", "uuid", "validator", "crypto", "fetch", "sleep",
  // JS keywords that look like variables
  "undefined", "null", "true", "false", "NaN", "Infinity",
  // Common globals
  "this", "arguments", "globalThis",
])

/**
 * Extract potential variable references from code
 * Only finds variables that are actually being READ, not defined
 */
function extractPotentialVariables(code: string): string[] {
  // Remove strings BEFORE comments. The line-comment regex (`//.*$`)
  // greedily eats from the first `//` to end-of-line, which destroys
  // string contents like `"https://example.com"` — the `://` looks like
  // a comment marker even though it's inside a string. That mangles the
  // closing quote and causes downstream string content to leak through
  // as identifiers (cart_id, unsubscribe, etc.).
  //
  // Stripping strings first replaces them with `""` so any `//` inside
  // them is gone before the comment regex runs. Order is otherwise
  // unchanged.
  let cleaned = code
    .replace(/`[\s\S]*?`/g, '""') // template literals -> empty string
    .replace(/"[^"]*"/g, '""') // double-quoted strings
    .replace(/'[^']*'/g, '""') // single-quoted strings
    .replace(/\/\/.*$/gm, "") // single line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // multi-line comments
  
  // Remove object literal keys (word followed by colon, not preceded by ?)
  // e.g., { processed: true } -> processed should not be flagged
  cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1""$3')
  
  // Remove property access (anything after a dot)
  // e.g., response.data -> data should not be flagged
  cleaned = cleaned.replace(/\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '.""')
  
  // Find remaining identifiers
  const identifierPattern = /(?<![.\w])([a-zA-Z_$][a-zA-Z0-9_$]*)/g
  const matches = cleaned.match(identifierPattern) || []
  
  // Filter out JS keywords
  const jsKeywords = new Set([
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "do", "switch", "case", "break", "continue", "try", "catch", "finally",
    "throw", "new", "typeof", "instanceof", "in", "of", "async", "await",
    "class", "extends", "super", "import", "export", "default", "from",
    "yield", "static", "get", "set", "delete", "void", "with", "debugger",
  ])
  
  return [...new Set(matches)].filter(id => !jsKeywords.has(id) && id !== '""')
}

/**
 * Resolve `{{ ... }}` template tokens in user code by binding each token's RAW
 * value into the sandbox under a generated identifier, instead of splicing a
 * JSON-stringified copy into the source text.
 *
 * This preserves the upstream value's type verbatim: `JSON.parse({{$last}})`
 * and `const x = {{$last}}` both receive the real object/string/number, with no
 * stringify→parse round-trip (which previously produced invalid source like
 * `JSON.parse({"a":1})` and threw `Expected property name or '}' at position 1`).
 */
function bindTemplateTokens(
  code: string,
  dataChain: Record<string, any>
): { code: string; bindings: Record<string, any> } {
  const bindings: Record<string, any> = {}
  let i = 0
  const boundCode = code.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, path) => {
    const name = `__tpl_${i++}`
    bindings[name] = getValueByPath(dataChain, String(path).trim())
    return name
  })
  return { code: boundCode, bindings }
}

/**
 * Build `$`-prefixed aliases for every named operation output in the data chain,
 * so user code can reference upstream steps directly — e.g.
 * `$read_data_123.records` — in addition to `$input.read_data_123` or
 * `{{ $read_data_123.records }}` tokens. Built-in `$`-keys ($last/$trigger) are
 * skipped (they're already exposed explicitly).
 */
function dollarAliases(dataChain: Record<string, any>): Record<string, any> {
  const aliases: Record<string, any> = {}
  for (const [key, value] of Object.entries(dataChain)) {
    if (!key.startsWith("$")) {
      aliases[`$${key}`] = value
    }
  }
  return aliases
}

/**
 * Validate code for potential issues before execution
 */
function validateCode(
  code: string,
  availablePackages: string[],
  extraVars: string[] = []
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  // Build set of all available variables
  const availableVars = new Set([
    ...BUILTIN_SANDBOX_VARS,
    ...availablePackages.map(p => p.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "")),
    ...extraVars,
  ])
  
  // Extract variables used in code
  const usedVars = extractPotentialVariables(code)
  
  // Check for undefined variables
  const potentiallyUndefined: string[] = []
  for (const varName of usedVars) {
    if (!availableVars.has(varName)) {
      // Check if it might be a user-defined variable (declared in code)
      const declPattern = new RegExp(`(?:const|let|var|function)\\s+${varName}\\b`)
      if (!declPattern.test(code)) {
        potentiallyUndefined.push(varName)
      }
    }
  }
  
  // Report undefined variables as errors only when they look like actual
  // npm packages — i.e. they're an exact match against a known whitelist.
  //
  // The previous heuristic (`v.includes("_")`) treated any snake_case
  // identifier as a probable package, which caused false-positive blocks
  // on perfectly normal user-code locals (cart_id, send_items, etc.).
  // Bare snake_case is too common in user code to be a useful package
  // signal — those go to warnings instead, and the sandbox will throw a
  // real ReferenceError at execution time if they actually are missing.
  if (potentiallyUndefined.length > 0) {
    const KNOWN_PACKAGES = [
      "axios", "moment", "cheerio", "lodash", "dayjs",
      "date_fns", "qs", "nanoid",
    ]
    const likelyPackages = potentiallyUndefined.filter((v) => {
      const norm = v.toLowerCase()
      return KNOWN_PACKAGES.some((p) => norm === p.replace("-", "_"))
    })

    if (likelyPackages.length > 0) {
      errors.push(
        `Undefined package(s): ${likelyPackages.join(", ")}. ` +
        `Add them to the "NPM Packages" field.`
      )
    }

    const otherUndefined = potentiallyUndefined.filter((v) => !likelyPackages.includes(v))
    if (otherUndefined.length > 0 && otherUndefined.length <= 5) {
      warnings.push(`Potentially undefined: ${otherUndefined.join(", ")}`)
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

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
    packages: z.array(z.string()).optional().describe("Additional npm packages to load (must be whitelisted)"),
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
    packages: [],
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    const startTime = Date.now()
    const logs: string[] = []
    
    try {
      const rawCode = options.code || ""
      const timeout = options.timeout || 5000
      const requestedPackages = options.packages || []

      console.log("[execute_code] Starting execution with code length:", rawCode.length)
      console.log("[execute_code] Requested packages:", requestedPackages)

      if (!rawCode.trim()) {
        return {
          success: false,
          error: "No code provided",
        }
      }

      // Resolve {{...}} template tokens to RAW sandbox bindings (no JSON
      // stringify→parse round-trip — preserves the upstream value's type).
      const { code, bindings: templateBindings } = bindTemplateTokens(
        rawCode,
        context.dataChain
      )

      // Expose each named operation output as a $-prefixed sandbox variable so
      // user code can reference upstream steps directly ($read_data_123.records).
      const aliases = dollarAliases(context.dataChain)
      const extraBindings = { ...aliases, ...templateBindings }

      // Validate code before execution (bindings/aliases are known identifiers)
      const validation = validateCode(code, requestedPackages, Object.keys(extraBindings))
      if (!validation.valid) {
        return {
          success: false,
          error: `Code validation failed:\n${validation.errors.join("\n")}`,
          data: { 
            validationErrors: validation.errors,
            validationWarnings: validation.warnings,
          },
        }
      }
      
      // Log warnings if any
      if (validation.warnings.length > 0) {
        validation.warnings.forEach(w => logs.push(`[WARN] ${w}`))
      }
      
      // Pick the execution backend. When VFLOW_USE_ISOLATED_VM is enabled, user
      // code runs inside a real isolated-vm sandbox (no host realm, no process/
      // require, hard memory + CPU limits) instead of the in-process
      // `new Function(...)` body — closing the code-injection half of the #1
      // prod RCE risk. Default is OFF, so production behaviour is unchanged.
      const isolated = isIsolatedVmEnabled()

      let result: any

      if (isolated) {
        // Block dangerous packages even in isolated mode (defence in depth)
        for (const pkgName of requestedPackages) {
          const baseName = pkgName.split("/")[0].replace("@", "")
          if (BLOCKED_PACKAGES.has(baseName) || BLOCKED_PACKAGES.has(pkgName)) {
            return {
              success: false,
              error: `Package '${pkgName}' is blocked for security reasons.`,
            }
          }
        }
        // External npm packages can't be bridged as live objects across the
        // isolate boundary yet. Built-ins (lodash/dayjs/validator/uuid/crypto)
        // are evaluated inside the isolate and remain available.
        if (requestedPackages.length > 0) {
          return {
            success: false,
            error:
              `External npm packages are not supported while VFLOW_USE_ISOLATED_VM is enabled ` +
              `(requested: ${requestedPackages.join(", ")}). Built-in packages ` +
              `(lodash, dayjs, validator, uuid, crypto) are available — remove the "packages" ` +
              `field, or disable isolated mode to load external packages.`,
          }
        }

        console.log("[execute_code] Running in isolated-vm sandbox")
        result = await runInIsolate(code, {
          dataChain: context.dataChain,
          extraBindings,
          logs,
          timeout,
        })
      } else {
        // Load requested external packages (from node_modules or auto-install)
        const externalPackages: Record<string, any> = {}
        const packageErrors: string[] = []

        for (const pkgName of requestedPackages) {
          // Security check - block dangerous packages
          const baseName = pkgName.split("/")[0].replace("@", "")
          if (BLOCKED_PACKAGES.has(baseName) || BLOCKED_PACKAGES.has(pkgName)) {
            return {
              success: false,
              error: `Package '${pkgName}' is blocked for security reasons.`,
            }
          }

          try {
            // Load package (auto-installs if not present)
            const pkg = await loadPackage(pkgName)
            // Convert package name to valid JS identifier (e.g., "date-fns" -> "date_fns")
            const varName = pkgName.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "")
            externalPackages[varName] = pkg
            logs.push(`[INFO] Loaded package: ${pkgName}`)
          } catch (err: any) {
            console.warn(`[execute_code] Failed to load package '${pkgName}': ${err.message}`)
            packageErrors.push(`${pkgName}: ${err.message}`)
          }
        }

        // If any packages failed to load, return error
        if (packageErrors.length > 0) {
          return {
            success: false,
            error: `Failed to load package(s):\n${packageErrors.join("\n")}`,
            data: { packageErrors },
          }
        }

        // Create a sandboxed execution environment ($-aliases + token bindings)
        const sandbox = createSandbox(context.dataChain, logs, externalPackages, extraBindings)

        console.log("[execute_code] Sandbox created with $last:", typeof context.dataChain.$last)

        // Execute with timeout (code is wrapped in async function inside runInSandbox)
        result = await executeWithTimeout(
          () => runInSandbox(code, sandbox),
          timeout
        )
      }
      
      const duration = Date.now() - startTime
      
      console.log("[execute_code] Code executed in", duration, "ms")
      console.log("[execute_code] Result type:", typeof result)
      console.log("[execute_code] Result value:", JSON.stringify(result)?.slice(0, 200))
      
      // If result is undefined, the code didn't return anything
      // Return the result directly (not wrapped) so it's usable by next operation
      const outputData = result !== undefined ? result : { _noReturn: true, logs }
      
      return {
        success: true,
        data: outputData,
      }
    } catch (error: any) {
      console.error("[execute_code] Error:", error.message)
      return {
        success: false,
        error: `Code execution failed: ${error.message}`,
        errorStack: error.stack,
        data: { logs, error: error.message },
      }
    }
  },
}

/**
 * Available npm packages in the sandbox
 * These are exposed to user code for convenience
 */
export const AVAILABLE_PACKAGES = {
  lodash: {
    name: "lodash",
    alias: "_",
    description: "Utility library for arrays, objects, strings",
    examples: ["_.map(arr, 'name')", "_.groupBy(arr, 'type')", "_.pick(obj, ['a', 'b'])"],
  },
  dayjs: {
    name: "dayjs",
    alias: "dayjs",
    description: "Date/time manipulation library",
    examples: ["dayjs().format('YYYY-MM-DD')", "dayjs(date).add(1, 'day')", "dayjs().diff(other, 'hours')"],
  },
  uuid: {
    name: "uuid",
    alias: "uuid",
    description: "Generate and validate UUIDs",
    examples: ["uuid.v4()", "uuid.validate('...')"],
  },
  validator: {
    name: "validator",
    alias: "validator",
    description: "String validation and sanitization",
    examples: ["validator.isEmail(str)", "validator.isURL(str)", "validator.escape(str)"],
  },
  crypto: {
    name: "crypto",
    alias: "crypto",
    description: "Cryptographic utilities (hashing, UUIDs)",
    examples: ["crypto.sha256(str)", "crypto.md5(str)", "crypto.randomUUID()"],
  },
  fetch: {
    name: "fetch",
    alias: "fetch",
    description: "Make HTTP requests (10s timeout)",
    examples: ["await fetch(url)", "await fetch(url, { method: 'POST', body: JSON.stringify(data) })"],
  },
}

/**
 * Create a sandboxed environment for code execution
 */
function createSandbox(
  dataChain: Record<string, any>,
  logs: string[],
  externalPackages: Record<string, any> = {},
  extraBindings: Record<string, any> = {}
) {
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
        logs.push(args.map(a => {
          try {
            return typeof a === 'string' ? a : JSON.stringify(a)
          } catch {
            return String(a)
          }
        }).join(" "))
      },
      error: (...args: any[]) => {
        logs.push(`[ERROR] ${args.map(a => {
          try {
            return typeof a === 'string' ? a : JSON.stringify(a)
          } catch {
            return String(a)
          }
        }).join(" ")}`)
      },
      warn: (...args: any[]) => {
        logs.push(`[WARN] ${args.map(a => {
          try {
            return typeof a === 'string' ? a : JSON.stringify(a)
          } catch {
            return String(a)
          }
        }).join(" ")}`)
      },
    },
    
    // Safe built-in utilities
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
    btoa: (str: string) => Buffer.from(str).toString('base64'),
    atob: (str: string) => Buffer.from(str, 'base64').toString('utf-8'),
    
    // ============ NPM PACKAGES ============
    
    // Lodash - full library (replaces custom _ helpers)
    _: lodash,
    lodash: lodash,
    
    // Day.js - date manipulation
    dayjs: dayjs,
    
    // UUID - generate unique IDs (using Node's crypto)
    uuid: {
      v4: () => crypto.randomUUID(),
      validate: (str: string) => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        return uuidRegex.test(str)
      },
    },
    
    // Validator - string validation
    validator: validator,
    
    // Crypto helpers
    crypto: {
      randomUUID: () => crypto.randomUUID(),
      hash: (algorithm: string, data: string) => {
        return crypto.createHash(algorithm).update(data).digest('hex')
      },
      md5: (data: string) => crypto.createHash('md5').update(data).digest('hex'),
      sha256: (data: string) => crypto.createHash('sha256').update(data).digest('hex'),
      hmac: (algorithm: string, key: string, data: string) => {
        return crypto.createHmac(algorithm, key).update(data).digest('hex')
      },
    },
    
    // ============ HELPER FUNCTIONS ============
    
    // Async fetch wrapper (limited)
    fetch: async (url: string, options?: RequestInit) => {
      // Only allow http/https
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('Only http:// and https:// URLs are allowed')
      }
      const response = await globalThis.fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        json: () => response.json(),
        text: () => response.text(),
      }
    },
    
    // Sleep helper
    sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5000))),
    
    // ============ EXTERNAL PACKAGES ============
    // Dynamically loaded packages requested by user
    ...externalPackages,

    // ============ DATA BINDINGS ============
    // $-aliases for named outputs + raw {{...}} token values (type-preserved,
    // no stringify round-trip).
    ...extraBindings,
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
    return (async function() {
      ${code}
    })();
  `)
  
  // Execute and await the result
  const result = await fn(...paramValues)
  
  return result
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
