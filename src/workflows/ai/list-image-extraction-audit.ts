import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/utils";
import { memory } from "../../mastra/memory";

export type ListImageExtractionAuditInput = {
  resource?: string
  prefix?: string
  limit?: number
}

export type ListImageExtractionAuditOutput = {
  items: Array<{
    timestamp: number
    resourceId?: string | null
    threadId?: string | null
    entity_type?: string | null
    itemsCount?: number
    result?: any
  }>
}

const validateInput = createStep(
  "validate-list-image-extraction-audit-input",
  async (input: ListImageExtractionAuditInput) => {
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50)
    // If both are provided, prefer resource (exact match) and ignore prefix
    // Normalize: decode URL-encoded resource/prefix once, if applicable
    const decodeOnce = (val?: string) => {
      if (!val) return val
      try {
        // Only decode if it looks URL-encoded
        return /%[0-9A-Fa-f]{2}/.test(val) ? decodeURIComponent(val) : val
      } catch {
        return val
      }
    }

    const normalizedResource = decodeOnce(input.resource)
    const normalizedPrefix = normalizedResource ? undefined : (decodeOnce(input.prefix) ?? "image-extraction:")

    return new StepResponse({
      resource: normalizedResource,
      prefix: normalizedPrefix,
      limit,
    })
  }
)

const getAudit = createStep(
  "get-image-extraction-audit",
  async (input: { resource?: string; prefix?: string; limit: number }) => {
    // Query Mastra Memory when resourceId is provided
    if (input.resource && memory) {
      try {
        // Prefer paginated API to avoid large fetches
        const page = 0
        const perPage = input.limit
        // getThreadsByResourceIdPaginated returns { threads, page, perPage, total }
        const result = await (memory as any).getThreadsByResourceIdPaginated?.({
          resourceId: input.resource,
          page,
          perPage,
        })
        const threads: any[] = result?.threads ?? []
        // Map threads to the audit output shape. We best-effort infer fields.
        const items = threads.map((t) => {
          const created = (t.createdAt ?? t.created_at ?? t.created_at_ms ?? Date.now()) as any
          const ts = typeof created === "number" ? created : Date.parse(created)
          const meta = t.metadata ?? t.meta ?? {}
          const lastMessage = Array.isArray(t.messages) ? t.messages[t.messages.length - 1] : undefined
          const maybeExtraction = lastMessage?.content ?? meta?.extraction ?? undefined
          return {
            timestamp: Number.isFinite(ts) ? ts : Date.now(),
            resourceId: t.resourceId ?? t.resource_id ?? input.resource,
            threadId: t.id ?? t.threadId ?? t.thread_id ?? undefined,
            entity_type: meta?.entity_type ?? undefined,
            itemsCount: Array.isArray(maybeExtraction?.items) ? maybeExtraction.items.length : undefined,
            result: maybeExtraction,
          }
        })

        return new StepResponse({ items } as ListImageExtractionAuditOutput)
      } catch {
        // On error, return empty list to avoid falling back to temporary storage
        return new StepResponse({ items: [] })
      }
    }
    // No resource provided or memory unavailable: return empty list (we've removed temporary storage)
    return new StepResponse({ items: [] })
  }
)

export const listImageExtractionAuditWorkflow = createWorkflow(
  {
    name: "list-image-extraction-audit",
  },
  (input: ListImageExtractionAuditInput) => {
    const validated = validateInput(input)
    const result = getAudit(validated)
    return new WorkflowResponse(result)
  }
)

export default listImageExtractionAuditWorkflow;
