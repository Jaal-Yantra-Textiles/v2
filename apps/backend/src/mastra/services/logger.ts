/**
 * AI V3 Logger Service
 *
 * Comprehensive logging utility for the AI V3 system.
 * Provides structured, detailed logging with:
 * - Configurable log levels (DEBUG, INFO, WARN, ERROR)
 * - Component identification
 * - Timing information
 * - JSON pretty-printing for complex objects
 * - Environment-based log level control
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

export interface LogEntry {
  timestamp: string
  level: LogLevel
  component: string
  message: string
  data?: any
  duration?: number
}

// ─── Configuration ───────────────────────────────────────────────────────────

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

// Get log level from environment (default: DEBUG for full visibility)
const currentLogLevel: LogLevel = (
  process.env.AI_V3_LOG_LEVEL?.toUpperCase() || "DEBUG"
) as LogLevel

// Check if we should use colors
const useColors = process.env.NO_COLOR !== "1" && process.env.NODE_ENV !== "production"

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bright: "\x1b[1m",
  debug: "\x1b[36m", // Cyan
  info: "\x1b[32m", // Green
  warn: "\x1b[33m", // Yellow
  error: "\x1b[31m", // Red
  component: "\x1b[35m", // Magenta
  data: "\x1b[90m", // Gray
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function colorize(text: string, color: keyof typeof colors): string {
  if (!useColors) return text
  return `${colors[color]}${text}${colors.reset}`
}

function formatTimestamp(): string {
  const now = new Date()
  const time = now.toISOString().split("T")[1].slice(0, 12) // HH:mm:ss.SSS
  return colorize(time, "dim")
}

function formatLevel(level: LogLevel): string {
  const padded = level.padEnd(5)
  switch (level) {
    case "DEBUG":
      return colorize(padded, "debug")
    case "INFO":
      return colorize(padded, "info")
    case "WARN":
      return colorize(padded, "warn")
    case "ERROR":
      return colorize(padded, "error")
    default:
      return padded
  }
}

function formatComponent(component: string): string {
  return colorize(`[${component}]`, "component")
}

function formatData(data: any, maxLength: number = 2000): string {
  if (data === undefined || data === null) return ""

  try {
    let str: string
    if (typeof data === "string") {
      str = data
    } else {
      str = JSON.stringify(data, null, 2)
    }

    // Truncate if too long
    if (str.length > maxLength) {
      str = str.slice(0, maxLength) + "\n... (truncated)"
    }

    return colorize("\n" + str, "data")
  } catch {
    return colorize("\n[Unable to serialize data]", "data")
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return colorize(`(${ms}ms)`, "dim")
  }
  return colorize(`(${(ms / 1000).toFixed(2)}s)`, "dim")
}

// ─── Logger Class ────────────────────────────────────────────────────────────

export class Logger {
  private component: string
  private timers: Map<string, number> = new Map()

  constructor(component: string) {
    this.component = component
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel]
  }

  /**
   * Core log method
   */
  private log(level: LogLevel, message: string, data?: any, duration?: number): void {
    if (!this.shouldLog(level)) return

    const parts = [
      formatTimestamp(),
      formatLevel(level),
      formatComponent(this.component),
      message,
    ]

    if (duration !== undefined) {
      parts.push(formatDuration(duration))
    }

    let output = parts.join(" ")

    if (data !== undefined) {
      output += formatData(data)
    }

    // Use appropriate console method
    switch (level) {
      case "ERROR":
        console.error(output)
        break
      case "WARN":
        console.warn(output)
        break
      default:
        console.log(output)
    }
  }

  /**
   * Debug level logging - for detailed debugging info
   */
  debug(message: string, data?: any): void {
    this.log("DEBUG", message, data)
  }

  /**
   * Info level logging - for general operational info
   */
  info(message: string, data?: any): void {
    this.log("INFO", message, data)
  }

  /**
   * Warn level logging - for potential issues
   */
  warn(message: string, data?: any): void {
    this.log("WARN", message, data)
  }

  /**
   * Error level logging - for errors
   */
  error(message: string, data?: any): void {
    this.log("ERROR", message, data)
  }

  /**
   * Start a timer for measuring duration
   */
  time(label: string): void {
    this.timers.set(label, Date.now())
    this.debug(`Timer started: ${label}`)
  }

  /**
   * End a timer and log the duration
   */
  timeEnd(label: string, message?: string): number {
    const start = this.timers.get(label)
    if (!start) {
      this.warn(`Timer '${label}' not found`)
      return 0
    }

    const duration = Date.now() - start
    this.timers.delete(label)

    const msg = message || `Timer completed: ${label}`
    this.log("DEBUG", msg, undefined, duration)

    return duration
  }

  /**
   * Log the start of an operation
   */
  operationStart(operation: string, context?: any): void {
    const separator = "─".repeat(50)
    this.info(`${separator}`)
    this.info(`START: ${operation}`)
    if (context) {
      this.debug("Context:", context)
    }
    this.time(operation)
  }

  /**
   * Log the end of an operation
   */
  operationEnd(operation: string, success: boolean, result?: any): void {
    const duration = this.timeEnd(operation)
    const status = success ? "SUCCESS" : "FAILED"
    this.info(`END: ${operation} - ${status}`, result ? { resultPreview: this.truncate(result, 500) } : undefined)
    const separator = "─".repeat(50)
    this.info(`${separator}`)
  }

  /**
   * Log a step in a multi-step process
   */
  step(stepNumber: number, totalSteps: number, description: string, data?: any): void {
    this.info(`Step ${stepNumber}/${totalSteps}: ${description}`, data)
  }

  /**
   * Log a sub-operation or nested call
   */
  subOperation(name: string, data?: any): void {
    this.debug(`  → ${name}`, data)
  }

  /**
   * Log input/output for a function
   */
  functionCall(funcName: string, input: any, output?: any): void {
    this.debug(`${funcName}()`, {
      input: this.truncate(input, 500),
      ...(output !== undefined ? { output: this.truncate(output, 500) } : {}),
    })
  }

  /**
   * Log an HTTP request
   */
  httpRequest(method: string, url: string, body?: any): void {
    this.debug(`HTTP ${method} ${url}`, body ? { body: this.truncate(body, 500) } : undefined)
  }

  /**
   * Log an HTTP response
   */
  httpResponse(status: number, url: string, body?: any): void {
    const level = status >= 400 ? "ERROR" : status >= 300 ? "WARN" : "DEBUG"
    this.log(level, `HTTP ${status} ${url}`, body ? { body: this.truncate(body, 500) } : undefined)
  }

  /**
   * Log a table of data (for arrays of objects)
   */
  table(label: string, data: any[]): void {
    if (!this.shouldLog("DEBUG")) return

    this.debug(`${label} (${data.length} items):`)
    if (data.length > 0) {
      // Get first few items
      const preview = data.slice(0, 5).map((item, i) => ({
        "#": i + 1,
        ...this.pickFields(item, ["id", "name", "status", "entity", "type"]),
      }))
      console.table(preview)
      if (data.length > 5) {
        this.debug(`... and ${data.length - 5} more items`)
      }
    }
  }

  /**
   * Log a separator line
   */
  separator(char: string = "═", length: number = 60): void {
    if (!this.shouldLog("DEBUG")) return
    console.log(colorize(char.repeat(length), "dim"))
  }

  /**
   * Log a header/title
   */
  header(title: string): void {
    this.separator("═")
    this.info(colorize(title.toUpperCase(), "bright"))
    this.separator("═")
  }

  /**
   * Helper: truncate a value for logging
   */
  private truncate(value: any, maxLength: number): any {
    if (value === null || value === undefined) return value

    if (typeof value === "string") {
      return value.length > maxLength ? value.slice(0, maxLength) + "..." : value
    }

    if (Array.isArray(value)) {
      if (value.length > 10) {
        return [...value.slice(0, 10), `... (${value.length - 10} more)`]
      }
      return value
    }

    if (typeof value === "object") {
      try {
        const str = JSON.stringify(value)
        if (str.length > maxLength) {
          return JSON.parse(str.slice(0, maxLength) + "}")
        }
        return value
      } catch {
        return "[Complex Object]"
      }
    }

    return value
  }

  /**
   * Helper: pick specific fields from an object
   */
  private pickFields(obj: any, fields: string[]): Record<string, any> {
    const result: Record<string, any> = {}
    for (const field of fields) {
      if (obj && field in obj) {
        result[field] = obj[field]
      }
    }
    return result
  }

  /**
   * Create a child logger with a sub-component name
   */
  child(subComponent: string): Logger {
    return new Logger(`${this.component}:${subComponent}`)
  }
}

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Create a logger instance for a component
 */
export function createLogger(component: string): Logger {
  return new Logger(component)
}

// ─── Pre-configured Loggers ──────────────────────────────────────────────────

export const workflowLogger = createLogger("AIv3:Workflow")
export const queryPlannerLogger = createLogger("AIv3:QueryPlanner")
export const planExecutorLogger = createLogger("AIv3:PlanExecutor")
export const serviceExecutorLogger = createLogger("AIv3:ServiceExecutor")
export const modelRotatorLogger = createLogger("AIv3:ModelRotator")
export const planStoreLogger = createLogger("AIv3:PlanStore")
export const embeddingLogger = createLogger("AIv3:Embedding")
export const entityClassifierLogger = createLogger("AIv3:EntityClassifier")

// ─── Global Log Level Control ────────────────────────────────────────────────

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel
}

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  return LOG_LEVELS["DEBUG"] >= LOG_LEVELS[currentLogLevel]
}

// ─── Log Aggregation ─────────────────────────────────────────────────────────

interface AggregatedLogs {
  entries: LogEntry[]
  summary: {
    totalLogs: number
    byLevel: Record<LogLevel, number>
    byComponent: Record<string, number>
    errors: string[]
    warnings: string[]
  }
}

const logBuffer: LogEntry[] = []
const MAX_BUFFER_SIZE = 1000

/**
 * Add a log entry to the buffer (for aggregation/export)
 */
export function bufferLog(entry: LogEntry): void {
  logBuffer.push(entry)
  if (logBuffer.length > MAX_BUFFER_SIZE) {
    logBuffer.shift() // Remove oldest
  }
}

/**
 * Get aggregated logs
 */
export function getAggregatedLogs(): AggregatedLogs {
  const summary = {
    totalLogs: logBuffer.length,
    byLevel: { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 } as Record<LogLevel, number>,
    byComponent: {} as Record<string, number>,
    errors: [] as string[],
    warnings: [] as string[],
  }

  for (const entry of logBuffer) {
    summary.byLevel[entry.level]++
    summary.byComponent[entry.component] = (summary.byComponent[entry.component] || 0) + 1

    if (entry.level === "ERROR") {
      summary.errors.push(`[${entry.component}] ${entry.message}`)
    }
    if (entry.level === "WARN") {
      summary.warnings.push(`[${entry.component}] ${entry.message}`)
    }
  }

  return {
    entries: [...logBuffer],
    summary,
  }
}

/**
 * Clear the log buffer
 */
export function clearLogBuffer(): void {
  logBuffer.length = 0
}

/**
 * Export logs as JSON
 */
export function exportLogsAsJson(): string {
  return JSON.stringify(getAggregatedLogs(), null, 2)
}
