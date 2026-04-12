import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { MESSAGING_MODULE } from "../../../modules/messaging"
import type { CreateConversationInput } from "./validators"

/**
 * GET /admin/messaging
 *
 * List conversations with last message preview and partner info.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { partner_id, status, limit, offset } = req.validatedQuery as any
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const filters: Record<string, any> = {}
  if (partner_id) filters.partner_id = partner_id
  if (status) filters.status = status

  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any

  const [conversations, count] = await messagingService.listAndCountMessagingConversations(
    filters,
    {
      order: { last_message_at: "DESC" },
      skip: offset || 0,
      take: limit || 20,
      relations: ["messages"],
    }
  )

  // Enrich with partner name and last message
  const enriched = await Promise.all(
    conversations.map(async (conv: any) => {
      let partner_name = "Unknown Partner"
      try {
        const { data: partners } = await query.graph({
          entity: "partners",
          fields: ["name"],
          filters: { id: conv.partner_id },
        })
        partner_name = partners?.[0]?.name || "Unknown Partner"
      } catch { /* fallback */ }

      // Get the most recent message
      const messages = conv.messages || []
      const sorted = [...messages].sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      const last_message = sorted[0] || null

      return {
        id: conv.id,
        partner_id: conv.partner_id,
        partner_name,
        title: conv.title,
        phone_number: conv.phone_number,
        status: conv.status,
        unread_count: conv.unread_count || 0,
        last_message_at: conv.last_message_at,
        last_message: last_message
          ? {
              content: last_message.content?.substring(0, 100),
              direction: last_message.direction,
              created_at: last_message.created_at,
            }
          : null,
        metadata: conv.metadata,
      }
    })
  )

  res.json({
    conversations: enriched,
    count,
    offset: offset || 0,
    limit: limit || 20,
  })
}

/**
 * POST /admin/messaging
 *
 * Create a new conversation with a partner.
 * Returns existing conversation if one already exists for partner+phone.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as CreateConversationInput
  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  // Check for existing conversation with same partner + phone
  const existing = await messagingService.listMessagingConversations(
    { partner_id: body.partner_id, phone_number: body.phone_number },
    { take: 1 }
  )

  if (existing?.length) {
    // Reactivate if archived
    if (existing[0].status === "archived") {
      await messagingService.updateMessagingConversations({
        id: existing[0].id,
        status: "active",
      })
    }
    return res.json({ conversation: existing[0] })
  }

  // Get partner name for title
  let title = body.title
  if (!title) {
    try {
      const { data: partners } = await query.graph({
        entity: "partners",
        fields: ["name"],
        filters: { id: body.partner_id },
      })
      title = partners?.[0]?.name || "Partner"
    } catch {
      title = "Partner"
    }
  }

  const conversation = await messagingService.createMessagingConversations({
    partner_id: body.partner_id,
    phone_number: body.phone_number,
    title,
    status: "active",
    unread_count: 0,
    metadata: {
      consent_given: true,
      consent_given_at: new Date().toISOString(),
      consent_source: "admin_initiated",
      onboarded: true,
    },
  })

  res.status(201).json({ conversation })
}
