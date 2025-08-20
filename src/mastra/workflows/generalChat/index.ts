// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows"
import { z } from "zod"
import { generalChatAgent } from "../../agents" // dedicated chat agent

export type GeneralChatInput = {
  message: string
  threadId?: string
  resourceId?: string
  context?: Record<string, any>
}

export type GeneralChatOutput = {
  reply: string
  toolCalls?: Array<{ name: string; arguments: Record<string, any> }>
  threadId?: string
  resourceId?: string
  // results of any activations we performed
  activations?: Array<{ name: string; arguments: Record<string, any>; result: any }>
}

// Basic intent detection to synthesize toolCalls if user explicitly asks for an action.
function inferToolCallsFromMessage(message: string): Array<{ name: string; arguments: Record<string, any> }> {
  const text = message.toLowerCase()
  const calls: Array<{ name: string; arguments: Record<string, any> }> = []

  if (/(create|add)\s+(inventory|stock)/.test(text)) {
    calls.push({ name: "create_inventory_from_levels", arguments: {} })
  }
  if (/(create|add)\s+(raw material|raw materials)/.test(text)) {
    calls.push({ name: "create_raw_materials", arguments: {} })
  }
  if (/(send|email)\s+(agreement|agreements)/.test(text)) {
    calls.push({ name: "send_agreements_to_persons", arguments: {} })
  }
  if (/(update|edit)\s+(design|product)/.test(text)) {
    calls.push({ name: "update_design", arguments: {} })
  }

  // Generic: detect direct API intents like "POST /admin/xyz" or "get /admin/products"
  const verbPath = message.match(/\b(get|post|put|patch|delete)\s+\/(?:admin|store)\/[\w\-\/{}/:?&=]+/i)
  if (verbPath) {
    const segs = verbPath[0].trim().split(/\s+/)
    if (segs.length >= 2) {
      const method = segs[0].toUpperCase()
      const path = segs.slice(1).join(" ") // in case of spaces
      calls.push({
        name: "admin_api_request",
        arguments: {
          method,
          path,
          openapi: { method, path },
        },
      })
    }
  }

  return calls
}

// Dispatcher to "activate" tools. For now, we standardize to return a planned Admin API request
// using official Admin API paths so the UI can infer required inputs from the OpenAPI catalog.
// The UI will execute via sdk.client.fetch.
async function executeTool(name: string, args: Record<string, any>) {
  switch (name) {
    case "create_inventory_from_levels": {
      // Standardize to official Admin API endpoint for creating an inventory item.
      // The UI will fetch the OpenAPI spec for POST /admin/inventory-items and prefill required fields.
      return {
        status: "planned",
        tool: name,
        args,
        request: {
          method: "POST",
          path: "/admin/inventory-items",
          // Optionally pass suggested defaults; UI will merge with required fields inferred from spec
          body: {
            title: args?.title,
            sku: args?.sku,
            description: args?.description,
          },
          // Spec hint for the UI to know which OpenAPI entry to use
          openapi: { method: "POST", path: "/admin/inventory-items" },
        },
      }
    }
    case "create_raw_materials": {
      // Keep as planned; define an official path if/when available.
      return {
        status: "planned",
        tool: name,
        args,
        request: {
          method: "POST",
          path: "/admin/ai/raw-materials", // custom until official endpoint is defined
          body: args || {},
          openapi: { method: "POST", path: "/admin/ai/raw-materials" },
        },
      }
    }
    case "send_agreements_to_persons": {
      // Map to our admin custom route; when standardized in Admin API, switch to official path.
      return {
        status: "planned",
        tool: name,
        args,
        request: {
          method: "POST",
          path: "/admin/persons/{person_id}/agreements/send",
          body: args || {},
          openapi: { method: "POST", path: "/admin/persons/{person_id}/agreements/send" },
        },
      }
    }
    case "update_design": {
      return {
        status: "planned",
        tool: name,
        args,
        request: {
          method: "PATCH",
          path: "/admin/ai/designs/{id}", // custom until official path is available
          body: args || {},
          openapi: { method: "PATCH", path: "/admin/ai/designs/{id}" },
        },
      }
    }
    case "admin_api_request": {
      // Generic pass-through for any admin endpoint hinted by the model or user
      const method = (args?.openapi?.method || args?.method || "POST").toUpperCase()
      const path = args?.openapi?.path || args?.path || "/admin"
      return {
        status: "planned",
        tool: name,
        args,
        request: {
          method,
          path,
          body: args?.body,
          openapi: { method, path },
        },
      }
    }
    default: {
      // Fallback: if args already contains method/path or openapi hints, wrap as planned
      const method = (args?.openapi?.method || args?.method || "").toUpperCase()
      const path = args?.openapi?.path || args?.path
      if (method && path) {
        return {
          status: "planned",
          tool: name,
          args,
          request: { method, path, body: args?.body, openapi: { method, path } },
        }
      }
      return { status: "unknown_tool", tool: name, args }
    }
  }
}

// Schemas for workflow IO (required for step-based execution/streaming)
const inputSchema = z.object({
  message: z.string(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  context: z.record(z.any()).optional(),
})

const toolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.any()),
})

const activationSchema = z.object({
  name: z.string(),
  arguments: z.record(z.any()),
  result: z.any(),
})

const outputSchema = z.object({
  reply: z.string(),
  toolCalls: z.array(toolCallSchema).optional(),
  activations: z.array(activationSchema).optional(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
})

// Step: generate reply, parse/infer tool calls, execute tool activations
const chatGenerate = createStep({
  id: "chat-generate",
  inputSchema,
  outputSchema,
  execute: async ({ inputData, mastra }) => {
    const threadId = inputData.threadId
    const resourceId = inputData.resourceId || "ai:general-chat"

    const system = [
      "You are a general-purpose AI assistant for a textile commerce platform.",
      "Maintain short, precise answers.",
      "If the user asks to take an action (e.g., create inventory, update design, send agreements), propose appropriate tool calls instead of claiming the action was done.",
      "Respond with normal text, and if tools are proposed, also include a JSON block with an array under key toolCalls: [{ name, arguments }].",
      "Tools and expected argument schemas:",
      "- create_inventory_from_levels: { title: string, sku?: string, quantity?: number, storage?: 'incoming'|'stocked', stock_location_id?: string, description?: string }",
      "- create_raw_materials: { ... }",
      "- send_agreements_to_persons: { agreement_id: string, person_ids?: string[] }",
      "- update_design: { design_id: string, ... }",
      "- admin_api_request: { method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', path: string, body?: any }",
      "If no tool is needed, return an empty toolCalls array.",
    ].join("\n")

    // Use the dedicated chat agent and ensure memory context is passed so threads are persisted
    let text = ""
    let newThreadId: string | undefined
    try {
      const prompt = `${system}\n\nUser: ${String(inputData.message || "")}`
      const runtimeAgent = generalChatAgent
      console.log("runtimeAgent", runtimeAgent)
      const gen = await runtimeAgent.generate(prompt, {
        memory: {
          // If threadId is provided, continue it; otherwise the agent will create one
          thread: threadId,
          resource: resourceId,
        },
      })
      console.log("gen", gen)
      text = (gen as any)?.text || ""
      newThreadId = (gen as any)?.threadId
      // If the model returned nothing, leave text empty; do not echo the user input
    } catch (err) {
      // Fallback: keep empty to avoid echoing user input
      console.error("generalChat chat-generate error", (err as any)?.message || err)
      text = ""
    }

    // Step 1: Parse toolCalls from model output (JSON block or fenced)
    let toolCalls: Array<{ name: string; arguments: Record<string, any> }> = []
    try {
      // 1) Try fenced ```json blocks
      const fenceMatch = text.match(/```json[\s\S]*?```/)
      const jsonStr = fenceMatch ? fenceMatch[0].replace(/```json|```/g, "").trim() : undefined
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr)
        if (parsed && Array.isArray(parsed.toolCalls)) {
          toolCalls = parsed.toolCalls
        }
      }

      // 2) Try plain JSON if entire text is JSON
      if (!toolCalls.length) {
        try {
          const parsedText = JSON.parse(text)
          if (parsedText && Array.isArray(parsedText.toolCalls)) {
            toolCalls = parsedText.toolCalls
          }
        } catch {}
      }

      // 3) Try loose 'json\n{ ... }' pattern (no fences)
      if (!toolCalls.length) {
        const idx = text.indexOf("{")
        if (idx !== -1) {
          const possible = text.slice(idx)
          // Heuristic: grab until last closing brace
          const last = possible.lastIndexOf("}")
          const objStr = last !== -1 ? possible.slice(0, last + 1) : possible
          try {
            const parsedLoose = JSON.parse(objStr)
            if (parsedLoose && Array.isArray(parsedLoose.toolCalls)) {
              toolCalls = parsedLoose.toolCalls
            }
          } catch {}
        }
      }
    } catch (_) {
      // ignore parse errors, treat as plain reply
    }

    // Step 2: If user explicitly asked for a tool in the message OR the reply mentions the tool, infer tool calls
    if (!toolCalls?.length) {
      const inferredFromUser = inferToolCallsFromMessage(inputData.message)
      const inferredFromReply = inferToolCallsFromMessage(text)
      const combined = [...inferredFromUser, ...inferredFromReply]
      if (combined.length) {
        // de-dup by name
        const seen = new Set<string>()
        toolCalls = combined.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)))
      }
    }

    // Step 3 (Tool-as-step): If any toolCalls present, activate them now via dispatcher
    let activations: Array<{ name: string; arguments: Record<string, any>; result: any }> = []
    if (toolCalls?.length) {
      for (const call of toolCalls) {
        const result = await executeTool(call.name, call.arguments || {})
        activations.push({ name: call.name, arguments: call.arguments || {}, result })
      }
    }

    return {
      reply: text,
      toolCalls,
      activations,
      threadId: newThreadId || threadId,
      resourceId,
    }
  },
})

export const generalChatWorkflow = createWorkflow({
  id: "generalChatWorkflow",
  inputSchema,
  outputSchema,
})
  .then(chatGenerate)
  .commit()

// Streaming is handled via WorkflowRun.streamVNext() from the route using createRunAsync().
