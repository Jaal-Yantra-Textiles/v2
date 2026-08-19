import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import AssistantContextCache from "./models/assistant-context-cache"

/**
 * Thin CRUD over the cross-conversation context cache, always scoped to a
 * (principal_id, surface) pair. The generated MedusaService methods handle
 * the heavy lifting; the helpers below enforce ownership scoping and provide
 * a clean upsert + list interface for the chat routes.
 */
class AssistantContextCacheService extends MedusaService({
  AssistantContextCache,
}) {
  /**
   * Read the cached context entries for a principal, optionally narrowed to
   * the domains this ask matched. Newest first. Excludes nothing — the table
   * is thin by design (one row per domain) so a full read is cheap.
   */
  async getContextForPrincipal(
    principalId: string,
    surface: string,
    domains?: string[]
  ) {
    const where: Record<string, unknown> = {
      principal_id: principalId,
      surface,
    }
    if (domains?.length) {
      where.domain = domains
    }
    return this.listAssistantContextCaches(where, {
      order: { updated_at: "DESC" },
    })
  }

  /**
   * Upsert a context entry for a (principal, surface, domain) triple.
   * If a row already exists for that triple, it is replaced — the most recent
   * context is the most relevant, and keeping history would bloat the
   * injection. On conflict, falls back to update-then-create to handle both
   * the unique-index upsert and the case where the row was soft-deleted.
   */
  async upsertContextEntry(input: {
    principalId: string
    surface: string
    domain: string
    entityIds: string[]
    summary: string
    conversationId?: string
  }) {
    const [existing] = await this.listAssistantContextCaches({
      principal_id: input.principalId,
      surface: input.surface,
      domain: input.domain,
    })

    if (existing) {
      const [updated] = await this.updateAssistantContextCaches([
        {
          id: existing.id,
          entity_ids: input.entityIds as any,
          summary: input.summary,
          conversation_id: input.conversationId ?? null,
        },
      ])
      return updated
    }

    try {
      return await this.createAssistantContextCaches({
        principal_id: input.principalId,
        surface: input.surface,
        domain: input.domain,
        entity_ids: input.entityIds as any,
        summary: input.summary,
        conversation_id: input.conversationId ?? null,
      })
    } catch (e) {
      // The list-then-create above is not atomic, and the unique index on
      // (principal_id, surface, domain) is doing its job: two turns of the same
      // conversation can finish close enough together that both saw no row.
      // Losing the write here would be silent — the caller swallows errors —
      // so re-read and update instead of surfacing a conflict as "no cache".
      const [raced] = await this.listAssistantContextCaches({
        principal_id: input.principalId,
        surface: input.surface,
        domain: input.domain,
      })
      if (!raced) throw e
      const [updated] = await this.updateAssistantContextCaches([
        {
          id: raced.id,
          entity_ids: input.entityIds as any,
          summary: input.summary,
          conversation_id: input.conversationId ?? null,
        },
      ])
      return updated
    }
  }

  /**
   * Remove all cache entries for a principal + surface. Called when a user is
   * deleted or when an explicit cache-clear is needed.
   */
  async clearContextForPrincipal(principalId: string, surface: string) {
    const entries = await this.listAssistantContextCaches({
      principal_id: principalId,
      surface,
    })
    if (!entries.length) return 0
    await this.deleteAssistantContextCaches(entries.map((e: any) => e.id))
    return entries.length
  }
}

export default AssistantContextCacheService
