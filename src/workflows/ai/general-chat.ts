import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { mastra } from "../../mastra"
import { createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"

export type GeneralChatInput = {
  message: string
  threadId?: string
  resourceId?: string
  context?: Record<string, any>
}

export type GeneralChatResult = {
  reply: string
  toolCalls?: Array<{ name: string; arguments: Record<string, any> }>
  threadId?: string
  resourceId?: string
  activations?: Array<{ name: string; arguments: Record<string, any>; result: any }>
}

const deriveStableResourceId = createStep(
  "general-chat:derive-stable-resource-id",
  async (input: GeneralChatInput) => {
    if (input.resourceId) return new StepResponse(input)
    const resourceId = "ai:general-chat"
    return new StepResponse({ ...input, resourceId })
  }
)

const runMastraGeneralChat = createStep(
  "general-chat:run-mastra",
  async (input: GeneralChatInput) => {
    try {
      const wf = mastra.getWorkflow?.("generalChatWorkflow") as any
      if (!wf) {
        // Deterministic fallback
        return new StepResponse({ reply: `You said: ${input.message}`, toolCalls: [], threadId: input.threadId, resourceId: input.resourceId } as GeneralChatResult)
      }

      // Prefer direct run if available
      if (typeof wf.run === "function") {
        const out = await wf.run({ inputData: {
          message: input.message,
          threadId: input.threadId,
          resourceId: input.resourceId,
          context: input.context,
        }})
        const reply = (out as any)?.reply ?? `You said: ${input.message}`
        const toolCalls = (out as any)?.toolCalls ?? []
        const threadId = (out as any)?.threadId ?? input.threadId
        const resourceId = (out as any)?.resourceId ?? input.resourceId
        return new StepResponse({ reply, toolCalls, threadId, resourceId } as GeneralChatResult)
      }

      // Fallback to createRunAsync/start
      const run = await wf.createRunAsync?.()
      const result = await run.start?.({ inputData: {
        message: input.message,
        threadId: input.threadId,
        resourceId: input.resourceId,
        context: input.context,
      } })

      const step = result
      const reply = (step as any)?.reply || (step as any)?.steps?.run?.output?.reply || `You said: ${input.message}`
      const toolCalls = (step as any)?.toolCalls || (step as any)?.steps?.run?.output?.toolCalls || []
      const threadId = (step as any)?.threadId || (step as any)?.steps?.run?.output?.threadId || input.threadId
      const resourceId = (step as any)?.resourceId || (step as any)?.steps?.run?.output?.resourceId || input.resourceId

      const out: GeneralChatResult = { reply, toolCalls, threadId, resourceId }
      return new StepResponse(out)
    } catch (_) {
      // Final fallback to keep API stable in CI
      return new StepResponse({ reply: `You said: ${input.message}`, toolCalls: [], threadId: input.threadId, resourceId: input.resourceId } as GeneralChatResult)
    }
  }
)

const executeToolCalls = createStep(
  "general-chat:execute-tools",
  async (input: GeneralChatResult, { container }) => {
    const calls = input.toolCalls || []
    const activations: Array<{ name: string; arguments: Record<string, any>; result: any }> = []

    for (const call of calls) {
      const name = call?.name
      const args = call?.arguments || {}

      switch (name) {
        case "create_inventory_from_levels": {
          // Expect arguments.inventory_levels: Array<{ inventory_item_id, location_id, stocked_quantity, incoming_quantity }>
          const levels = Array.isArray(args?.inventory_levels) ? args.inventory_levels : []
          if (!levels.length) {
            activations.push({ name, arguments: args, result: { error: "No inventory_levels provided" } })
            break
          }
          const { result } = await createInventoryLevelsWorkflow(container).run({
            input: { inventory_levels: levels },
          })
          activations.push({ name, arguments: args, result })
          break
        }
        default: {
          // Unrecognized tool - echo back for client-side handling
          activations.push({ name: name || "unknown", arguments: args, result: { status: "ignored" } })
        }
      }
    }

    return new StepResponse({ ...input, activations })
  }
)

export const generalChatMedusaWorkflow = createWorkflow(
  "general-chat-medusa",
  (input: GeneralChatInput) => {
    const withId = deriveStableResourceId(input)
    const res = runMastraGeneralChat(withId)
    const executed = executeToolCalls(res)
    return new WorkflowResponse(executed)
  }
)
