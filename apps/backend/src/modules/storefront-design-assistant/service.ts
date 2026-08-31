import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import StorefrontDesignConversation from "./models/storefront-design-conversation"

/**
 * Storefront design-assistant conversation store — thin CRUD over saved chat
 * threads for the shop's chat-based design editor.
 *
 * Mirror of AdminAssistantService with the design-flow scoping: threads scope
 * by normalised maker EMAIL (the flow's gate — the chat is public, no login),
 * NOT an auth actor id. Every helper normalises + asserts the email so a
 * route can never read or mutate another maker's thread by passing ids.
 *
 * The heavy `messages` blob is excluded from list responses by default so the
 * thread list stays light.
 */
export type DesignConversationScope = {
  customer_email: string
  thread_key: string
}

class StorefrontDesignAssistantService extends MedusaService({
  StorefrontDesignConversation,
}) {
  /** Normalise an email for scoping — lowercase + trim, or throw. */
  static normalizeEmail(email: string): string {
    const normalized = String(email ?? "").trim().toLowerCase()
    if (!normalized) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "customer_email is required to scope design conversations"
      )
    }
    return normalized
  }

  /** The maker's conversations for one thread key, newest first. Excludes the
   * heavy `messages` blob so the history list stays light. */
  async listConversationsForScope(
    scope: DesignConversationScope,
    { withMessages = false }: { withMessages?: boolean } = {}
  ) {
    return this.listStorefrontDesignConversations(
      {
        customer_email: StorefrontDesignAssistantService.normalizeEmail(
          scope.customer_email
        ),
        thread_key: scope.thread_key,
      },
      {
        order: { updated_at: "DESC" },
        ...(withMessages
          ? {}
          : {
              select: [
                "id",
                "title",
                "design_id",
                "created_at",
                "updated_at",
              ] as any,
            }),
      }
    )
  }

  /** Fetch one conversation, 404-ing if it doesn't exist OR isn't the email's —
   * the same response either way so ids aren't probeable. */
  async getConversationForScope(scope: DesignConversationScope, id: string) {
    const [row] = await this.listStorefrontDesignConversations({
      id,
      customer_email: StorefrontDesignAssistantService.normalizeEmail(
        scope.customer_email
      ),
    })
    if (!row) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Conversation ${id} not found`
      )
    }
    return row
  }

  createConversationForScope(
    scope: DesignConversationScope,
    input: {
      title?: string
      design_id?: string
      messages?: unknown[]
    }
  ) {
    // `messages` is an array stored in a json column, which the generated
    // create typing narrows to an object — cast at the boundary.
    return this.createStorefrontDesignConversations({
      customer_email: StorefrontDesignAssistantService.normalizeEmail(
        scope.customer_email
      ),
      thread_key: scope.thread_key,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.design_id !== undefined ? { design_id: input.design_id } : {}),
      messages: (input.messages ?? []) as any,
    })
  }

  /** Update title / messages / design link, first asserting the row is the
   * email's. */
  async updateConversationForScope(
    scope: DesignConversationScope,
    id: string,
    input: {
      title?: string
      design_id?: string
      messages?: unknown[]
    }
  ) {
    await this.getConversationForScope(scope, id)
    const [updated] = await this.updateStorefrontDesignConversations([
      {
        id,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.design_id !== undefined
          ? { design_id: input.design_id }
          : {}),
        // json column holds an array; cast past the object-narrowed typing.
        ...(input.messages !== undefined
          ? { messages: input.messages as any }
          : {}),
      },
    ])
    return updated
  }

  async deleteConversationForScope(
    scope: DesignConversationScope,
    id: string
  ) {
    await this.getConversationForScope(scope, id)
    await this.deleteStorefrontDesignConversations(id)
    return true
  }
}

export default StorefrontDesignAssistantService
