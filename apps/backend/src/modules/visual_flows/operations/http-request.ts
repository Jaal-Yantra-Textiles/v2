import { z } from "@medusajs/framework/zod"
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
      
      // Determine body: use explicit body option, or fall back to $last for POST/PUT/PATCH
      let body: any = undefined
      if (options.body) {
        body = interpolateVariables(options.body, context.dataChain)
      } else if (["POST", "PUT", "PATCH"].includes(options.method) && context.dataChain.$last) {
        // Auto-pass $last as body for POST/PUT/PATCH if no explicit body
        body = context.dataChain.$last
      }
      
      console.log("[http_request] Making request:", {
        method: options.method,
        url,
        hasBody: !!body,
        bodyPreview: body ? JSON.stringify(body).slice(0, 100) : null,
      })
      
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
        
        // Get response text first, then try to parse as JSON
        const responseText = await response.text()
        let responseData: any
        
        if (responseText) {
          const contentType = response.headers.get("content-type")
          if (contentType?.includes("application/json")) {
            try {
              responseData = JSON.parse(responseText)
            } catch {
              // JSON parse failed, use text
              responseData = responseText
            }
          } else {
            responseData = responseText
          }
        } else {
          // Empty response
          responseData = null
        }
        
        console.log("[http_request] Response:", {
          status: response.status,
          hasData: responseData !== null,
        })
        
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
      console.error("[http_request] Error:", error.message)
      return {
        success: false,
        error: error.message,
        errorStack: error.stack,
      }
    }
  },
}
