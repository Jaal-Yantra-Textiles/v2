import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"
import { memory } from "../../../../../../mastra/memory"

const ThreadQuery = z.object({
  resourceId: z.string().min(1).optional(),
  page: z
    .preprocess((v) => (v === undefined ? 0 : Number(v)), z.number().int().min(0))
    .optional(),
  perPage: z
    .preprocess((v) => (v === undefined ? 50 : Number(v)), z.number().int().min(1).max(200))
    .optional(),
  format: z.enum(["v1", "v2"]).optional(),
})

type ThreadOut = {
  id: string
  resourceId: string
  title?: string
  createdAt?: string
  updatedAt?: string
  metadata?: Record<string, unknown>
}

const normalizeThread = (t: any): ThreadOut => {
  const id = String(t?.id ?? t?.threadId ?? t?.thread_id ?? "")
  const resourceId = String(t?.resourceId ?? t?.resource_id ?? "")
  const title = typeof t?.title === "string" ? t.title : undefined
  const createdAtRaw = t?.createdAt ?? t?.created_at
  const updatedAtRaw = t?.updatedAt ?? t?.updated_at
  const createdAt = createdAtRaw ? new Date(createdAtRaw).toISOString() : undefined
  const updatedAt = updatedAtRaw ? new Date(updatedAtRaw).toISOString() : undefined
  const metadata = (t?.metadata ?? t?.meta) as Record<string, unknown> | undefined

  return {
    id,
    resourceId,
    title,
    createdAt,
    updatedAt,
    metadata,
  }
}

type UiMessageOut = {
  id?: string
  role?: string
  content?: any
  createdAt?: string
  metadata?: Record<string, unknown>
}

const normalizeUiMessage = (m: any): UiMessageOut => {
  const createdAtRaw = m?.createdAt ?? m?.created_at
  const createdAt = createdAtRaw ? new Date(createdAtRaw).toISOString() : undefined
  return {
    id: typeof m?.id === "string" ? m.id : undefined,
    role: typeof m?.role === "string" ? m.role : undefined,
    content: m?.content,
    createdAt,
    metadata: (m?.metadata ?? m?.meta) as Record<string, unknown> | undefined,
  }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const threadId = String((req as any)?.params?.threadId || "")
    if (!threadId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "threadId is required")
    }

    const parsed = ThreadQuery.safeParse((req as any).validatedQuery || req.query || {})
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ")
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid query")
    }

    if (!memory) {
      return res.status(503).json({ message: "Mastra memory is not configured" })
    }

    const resourceId = parsed.data.resourceId
    const page = parsed.data.page ?? 0
    const perPage = parsed.data.perPage ?? 50
    const format = parsed.data.format

    const thread = await (memory as any).getThreadById?.({ threadId })

    if (!thread) {
      return res.status(404).json({ message: "Thread not found" })
    }

    const result = await (memory as any).query?.({
      threadId,
      resourceId,
      selectBy: {
        pagination: { page, perPage },
      },
      format,
    })

    const uiMessages = Array.isArray(result?.uiMessages) ? result.uiMessages : []
    const messages = Array.isArray(result?.messages) ? result.messages : []

    return res.status(200).json({
      thread: normalizeThread(thread),
      uiMessages: uiMessages.map(normalizeUiMessage),
      messages,
      page,
      perPage,
    })
  } catch (e) {
    const err = e as Error
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : e.type === MedusaError.Types.NOT_FOUND ? 404 : 500
      return res.status(status).json({ message: err.message })
    }
    return res.status(500).json({ message: err.message || "Unexpected error" })
  }
}
