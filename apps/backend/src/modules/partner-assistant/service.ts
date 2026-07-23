import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import PartnerAssistantConversation from "./models/partner-assistant-conversation"

/**
 * Partner assistant conversation store — thin CRUD over saved chat threads,
 * always scoped to the authenticated partner. The generated MedusaService
 * methods do the heavy lifting; the helpers below enforce partner ownership so
 * a route can never read or mutate another partner's conversation.
 */
class PartnerAssistantService extends MedusaService({
  PartnerAssistantConversation,
}) {
  /** The partner's conversations, newest first. Excludes the heavy `messages`
   * blob by default so the history list stays light. */
  async listConversationsForPartner(
    partnerId: string,
    { withMessages = false }: { withMessages?: boolean } = {}
  ) {
    return this.listPartnerAssistantConversations(
      { partner_id: partnerId },
      {
        order: { updated_at: "DESC" },
        ...(withMessages
          ? {}
          : { select: ["id", "title", "created_at", "updated_at"] as any }),
      }
    )
  }

  /** Fetch one conversation, 404-ing if it doesn't exist OR isn't the
   * partner's — the same response either way so ids aren't probeable. */
  async getConversationForPartner(partnerId: string, id: string) {
    const [row] = await this.listPartnerAssistantConversations({
      id,
      partner_id: partnerId,
    })
    if (!row) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Conversation ${id} not found`
      )
    }
    return row
  }

  createConversationForPartner(
    partnerId: string,
    input: { title?: string; messages?: unknown[] }
  ) {
    // `messages` is an array stored in a json column, which the generated
    // create typing narrows to an object — cast at the boundary.
    return this.createPartnerAssistantConversations({
      partner_id: partnerId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      messages: (input.messages ?? []) as any,
    })
  }

  /** Update title and/or messages, first asserting the row is the partner's. */
  async updateConversationForPartner(
    partnerId: string,
    id: string,
    input: { title?: string; messages?: unknown[] }
  ) {
    await this.getConversationForPartner(partnerId, id)
    const [updated] = await this.updatePartnerAssistantConversations([
      {
        id,
        ...(input.title !== undefined ? { title: input.title } : {}),
        // json column holds an array; cast past the object-narrowed typing.
        ...(input.messages !== undefined
          ? { messages: input.messages as any }
          : {}),
      },
    ])
    return updated
  }

  async deleteConversationForPartner(partnerId: string, id: string) {
    await this.getConversationForPartner(partnerId, id)
    await this.deletePartnerAssistantConversations(id)
    return true
  }
}

export default PartnerAssistantService
