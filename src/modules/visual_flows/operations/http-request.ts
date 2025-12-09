import { z } from "zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables, interpolateString } from "./utils"

export const httpRequestOperation: OperationDefinition = {
  type: "http_request",
  name: "HTTP Request",
  description: "Make an HTTP request to an external service",
  icon: "globe",
  category: "integration",
  
  optionsSchema: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.string().describe("Request URL"),
    headers: z.record(z.string()).optional().describe("Request headers"),
    body: z.any().optional().describe("Request body (for POST/PUT/PATCH)"),
    timeout_ms: z.number().optional().default(30000).describe("Request timeout in milliseconds"),
  }),
  
  defaultOptions: {
    method: "GET",
    url: "",
    headers: {},
    timeout_ms: 30000,
  },
  
  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      // Interpolate variables
      const url = interpolateString(options.url, context.dataChain)
      const headers = interpolateVariables(options.headers || {}, context.dataChain)
      const body = options.body ? interpolateVariables(options.body, context.dataChain) : undefined
      
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), options.timeout_ms || 30000)
      
      try {
        const response = await fetch(url, {
          method: options.method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })
        
        clearTimeout(timeoutId)
        
        // Try to parse response as JSON, fallback to text
        let responseData: any
        const contentType = response.headers.get("content-type")
        if (contentType?.includes("application/json")) {
          responseData = await response.json()
        } else {
          responseData = await response.text()
        }
        
        return {
          success: response.ok,
          data: {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            data: responseData,
          },
          error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId)
        
        if (fetchError.name === "AbortError") {
          return {
            success: false,
            error: `Request timeout after ${options.timeout_ms}ms`,
          }
        }
        throw fetchError
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        errorStack: error.stack,
      }
    }
  },
}
