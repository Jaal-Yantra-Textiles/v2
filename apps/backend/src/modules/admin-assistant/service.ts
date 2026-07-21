import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import AdminAssistantConversation from "./models/admin-assistant-conversation"

/**
 * Admin assistant conversation store — thin CRUD over saved chat threads,
 * always scoped to the authenticated admin user. The generated MedusaService
 * methods do the heavy lifting; the helpers below enforce user ownership so a
 * route can never read or mutate another user's conversation.
 *
 * Mirrors PartnerAssistantService (partner_id → user_id).
 */
class AdminAssistantService extends MedusaService({
  AdminAssistantConversation,
}) {
  /** The user's conversations, newest first. Excludes the heavy `messages`
   * blob by default so the history list stays light. */
  async listConversationsForUser(
    userId: string,
    { withMessages = false }: { withMessages?: boolean } = {}
  ) {
    return this.listAdminAssistantConversations(
      { user_id: userId },
      {
        order: { updated_at: "DESC" },
        ...(withMessages
          ? {}
          : { select: ["id", "title", "created_at", "updated_at"] as any }),
      }
    )
  }

  /** Fetch one conversation, 404-ing if it doesn't exist OR isn't the user's —
   * the same response either way so ids aren't probeable. */
  async getConversationForUser(userId: string, id: string) {
    const [row] = await this.listAdminAssistantConversations({
      id,
      user_id: userId,
    })
    if (!row) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Conversation ${id} not found`
      )
    }
    return row
  }

  createConversationForUser(
    userId: string,
    input: { title?: string; messages?: unknown[] }
  ) {
    // `messages` is an array stored in a json column, which the generated
    // create typing narrows to an object — cast at the boundary.
    return this.createAdminAssistantConversations({
      user_id: userId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      messages: (input.messages ?? []) as any,
    })
  }

  /** Update title and/or messages, first asserting the row is the user's. */
  async updateConversationForUser(
    userId: string,
    id: string,
    input: { title?: string; messages?: unknown[] }
  ) {
    await this.getConversationForUser(userId, id)
    const [updated] = await this.updateAdminAssistantConversations([
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

  async deleteConversationForUser(userId: string, id: string) {
    await this.getConversationForUser(userId, id)
    await this.deleteAdminAssistantConversations(id)
    return true
  }
}

export default AdminAssistantService
