import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"
import { memory } from "../../../../../mastra/memory"

const ThreadsListQuery = z.object({
  resourceId: z.string().min(1, { message: "resourceId is required" }),
  page: z
    .preprocess((v) => (v === undefined ? 0 : Number(v)), z.number().int().min(0))
    .optional(),
  perPage: z
    .preprocess((v) => (v === undefined ? 20 : Number(v)), z.number().int().min(1).max(100))
    .optional(),
  orderBy: z.enum(["createdAt", "updatedAt"]).optional(),
  sortDirection: z.enum(["ASC", "DESC"]).optional(),
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

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const parsed = ThreadsListQuery.safeParse((req as any).validatedQuery || req.query || {})

    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ")
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid query")
    }

    if (!memory) {
      return res.status(503).json({ message: "Mastra memory is not configured" })
    }

    const { resourceId } = parsed.data
    const page = parsed.data.page ?? 0
    const perPage = parsed.data.perPage ?? 20
    const orderBy = parsed.data.orderBy
    const sortDirection = parsed.data.sortDirection

    const result = await (memory as any).getThreadsByResourceIdPaginated?.({
      resourceId,
      page,
      perPage,
      orderBy,
      sortDirection,
    })

    if (result?.threads) {
      return res.status(200).json({
        threads: (result.threads || []).map(normalizeThread),
        page: result.page ?? page,
        perPage: result.perPage ?? perPage,
        total: result.total ?? (result.threads?.length || 0),
      })
    }

    const threads = await (memory as any).getThreadsByResourceId?.({
      resourceId,
      orderBy,
      sortDirection,
    })

    const all = Array.isArray(threads) ? threads : []
    const start = page * perPage
    const slice = all.slice(start, start + perPage)

    return res.status(200).json({
      threads: slice.map(normalizeThread),
      page,
      perPage,
      total: all.length,
    })
  } catch (e) {
    const err = e as Error
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: err.message })
    }
    return res.status(500).json({ message: err.message || "Unexpected error" })
  }
}

const CreateThreadBody = z.object({
  resourceId: z.string().min(1, { message: "resourceId is required" }),
  threadId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
})

type CreateThreadBodyType = z.infer<typeof CreateThreadBody>

export const POST = async (req: MedusaRequest<CreateThreadBodyType>, res: MedusaResponse) => {
  try {
    const parsed = CreateThreadBody.safeParse((req as any).validatedBody || req.body || {})

    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => e.message).join(", ")
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message || "Invalid request body")
    }

    if (!memory) {
      return res.status(503).json({ message: "Mastra memory is not configured" })
    }

    const thread = await (memory as any).createThread({
      resourceId: parsed.data.resourceId,
      threadId: parsed.data.threadId,
      title: parsed.data.title,
      metadata: parsed.data.metadata,
    })

    return res.status(201).json({ thread: normalizeThread(thread) })
  } catch (e) {
    const err = e as Error
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: err.message })
    }
    return res.status(500).json({ message: err.message || "Unexpected error" })
  }
}
