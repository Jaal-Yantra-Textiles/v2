import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { mastra, mastraStorageInit } from "../../mastra"
import { queryAdminEndpoints } from "../../mastra/rag/adminCatalog"

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
      await mastraStorageInit

      // Initialize and run using the same reliable pattern as image-extraction
      const run = await mastra.getWorkflow("generalChatWorkflow").createRunAsync()
      const result = await run.start({ inputData: {
        message: input.message,
        threadId: input.threadId,
        resourceId: input.resourceId,
        context: input.context,
      } })

      const reply = (result as any)?.reply
        ?? (result as any)?.steps?.run?.output?.reply
        ?? ""
      const toolCalls = (result as any)?.toolCalls
        ?? (result as any)?.steps?.run?.output?.toolCalls
        ?? []
      const activations = (result as any)?.activations
        ?? (result as any)?.steps?.run?.output?.activations
        ?? []
      const threadId = (result as any)?.threadId
        ?? (result as any)?.steps?.run?.output?.threadId
        ?? input.threadId
      const resourceId = (result as any)?.resourceId
        ?? (result as any)?.steps?.run?.output?.resourceId
        ?? input.resourceId

      // Try to detect error surfaces from Mastra run
      const detectedError: any = (result as any)?.error
        || (result as any)?.steps?.run?.error
        || (result as any)?.steps?.run?.output?.error

      if (detectedError) {
        const msg = typeof detectedError === "string" ? detectedError : (detectedError?.message || JSON.stringify(detectedError))
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `chat-generate error ${msg}`)
      }

      // If reply is empty, consider it an error from provider
      if (!reply || (typeof reply === "string" && reply.trim() === "")) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "chat-generate error Provider returned empty reply")
      }

      return new StepResponse({ reply, toolCalls, activations, threadId, resourceId, message: input.message } as any)
    } catch (e: any) {
      // Propagate error so API/stream can surface it to UI
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `chat-generate error ${e?.message || e}`)
    }
  }
)

// Augment tool calls with RAG/index candidates and lightweight schemas
const augmentToolCallsWithRag = createStep(
  "general-chat:augment-tools-with-rag",
  async (input: any) => {
    const calls = Array.isArray(input?.toolCalls) ? input.toolCalls : []
    const message: string = String(input?.message || "")
    const augmented = [] as Array<{ name: string; arguments: Record<string, any> } & { ragCandidates?: any[] }>
    for (const call of calls) {
      const name = call?.name
      const args = call?.arguments || {}
      if (name === "admin_api_request") {
        const method = String(args?.openapi?.method || args?.method || "").toUpperCase()
        const path = String(args?.openapi?.path || args?.path || "")
        try {
          const rag = await queryAdminEndpoints(`${method} ${path} ${message}`.trim(), method || undefined, 5)
          augmented.push({ ...call, ragCandidates: rag })
        } catch {
          augmented.push({ ...call })
        }
      } else {
        augmented.push({ ...call })
      }
    }
    return new StepResponse({ ...input, toolCalls: augmented })
  }
)

// Generic execute: server does not execute actions; defer to client using planned toolCalls
const executeToolCalls = createStep(
  "general-chat:execute-tools",
  async (input: GeneralChatResult) => {
    return new StepResponse({ ...input, activations: input.activations || [] })
  }
)

export const generalChatMedusaWorkflow = createWorkflow(
  "general-chat-medusa",
  (input: GeneralChatInput) => {
    const withId = deriveStableResourceId(input)
    const res = runMastraGeneralChat(withId)
    const augmented = augmentToolCallsWithRag(res)
    const executed = executeToolCalls(augmented as any)
    return new WorkflowResponse(executed)
  }
)
