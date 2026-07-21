/**
 * POST /admin/mcp/resolve-query — natural-language → execution-plan resolver.
 *
 * The canonical home of the former V4 admin-chat "resolve" capability (hybrid
 * BM25 code search + LLM analysis via `HybridQueryResolverService`). It is
 * exposed as the admin MCP `resolve_admin_query` tool so the MCP-backed Admin
 * Assistant retains this capability after the V4 chat is deprecated
 * (`ADMIN_V4_CHAT_DEPRECATED`). Independent of the legacy routes on purpose:
 * this one is never gated, so no capability regresses.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HybridQueryResolverService } from "../../../../mastra/services/hybrid-query-resolver"

// Singleton — the resolver builds an in-process BM25 index; keep one per process.
let resolverInstance: HybridQueryResolverService | null = null

function getResolver(): HybridQueryResolverService {
  if (!resolverInstance) {
    resolverInstance = new HybridQueryResolverService({
      llmApiKey: process.env.OPENROUTER_API_KEY,
      projectRoot: process.cwd(),
      useIndexedFirst: true,
      maxSearchResults: 5,
    })
  }
  return resolverInstance
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const body = (req as any).validatedBody || req.body || {}
    const query = body.query as string | undefined

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Missing required field: query" })
    }

    const resolver = getResolver()
    const indexedStatus = resolver.hasIndexedDocs()

    const startTime = Date.now()
    const resolved = await resolver.resolve(query)
    const duration = Date.now() - startTime

    res.json({
      resolved,
      meta: { duration_ms: duration, indexed_docs: indexedStatus },
    })
  } catch (error: any) {
    const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error(`[admin/mcp/resolve-query] ${error}`)
    res.status(500).json({ error: error?.message || "Failed to resolve query" })
  }
}
