import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { MESSAGING_MODULE } from "../../../../../modules/messaging"
import { SOCIAL_PROVIDER_MODULE } from "../../../../../modules/social-provider"
import type SocialProviderService from "../../../../../modules/social-provider/service"
import { TEMPLATE_NAMES } from "../../../../../scripts/whatsapp-templates/partner-run-templates"
import { composeOutreachText } from "../../../../../workflows/whatsapp/whatsapp-outreach-prose"
import { proseLanguageFor } from "../../../../../workflows/whatsapp/whatsapp-reminder-prose"
import {
  PHOTO_CONTEXT_KINDS,
  UNSUPPORTED_KINDS,
  buildPhotoRequestPurpose,
  resolveContextExpiry,
  type PhotoContextKind,
} from "../../../../../workflows/whatsapp/whatsapp-photo-context"

const BUSINESS_NAME = process.env.WHATSAPP_BUSINESS_NAME || "JYT Textiles"

/**
 * POST /admin/messaging/:conversationId/request-photos
 *
 * Ask a partner for photos AND record what they will be for, in one operation.
 *
 * #2138 — a photo carries no evidence of its own purpose. Fabric being sold to
 * us looks exactly like fabric we are having made, and the pipeline that
 * guessed asked "what product is this?", a question that presupposed its own
 * subject. The fix is to take the purpose from whoever actually knows it: the
 * admin who asked for the photos.
 *
 * 🔑 Two writes that must not diverge, in this order:
 *
 *   1. SEND the request
 *   2. only then STAMP `photo_context`
 *
 * Stamping first would leave a context live for a request that never arrived —
 * photos reinterpreted under an intent nobody communicated. Same ordering rule
 * as `asked_at` in `jobs/ask-about-photo-batches.ts`, and for the same reason:
 * the silent half of a failure is the one that hurts.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { conversationId } = req.params
  const { kind, note, message, ttl_hours } = (req.validatedBody ??
    req.body ??
    {}) as {
    kind?: string
    note?: string
    message?: string
    ttl_hours?: number
  }

  if (!kind) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `kind is required. One of: ${Object.keys(PHOTO_CONTEXT_KINDS).join(", ")}`
    )
  }
  if (UNSUPPORTED_KINDS[kind]) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, UNSUPPORTED_KINDS[kind])
  }
  if (!(kind in PHOTO_CONTEXT_KINDS)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown kind "${kind}". One of: ${Object.keys(PHOTO_CONTEXT_KINDS).join(", ")}`
    )
  }

  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any
  const conversation = await messagingService
    .retrieveMessagingConversation(conversationId, { relations: ["messages"] })
    .catch(() => null)
  if (!conversation) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Conversation not found")
  }

  const meta = (conversation.metadata ?? {}) as Record<string, any>

  // The sentence the partner reads. Written for this ask, in the language they
  // chose at registration (#2130) — not inferred from their button taps, which
  // carry our words rather than theirs.
  const composed = await composeOutreachText(req.scope as any, {
    partner_name: conversation.title || "there",
    business_name: BUSINESS_NAME,
    purpose: buildPhotoRequestPurpose(kind as PhotoContextKind, note),
    language: proseLanguageFor(meta.language),
  })
  const text = (message ?? "").trim() || composed.text

  /**
   * Free text only reaches a partner inside Meta's 24-hour window. Outside it
   * the prose carrier does the same job under one approval — which is the only
   * reason an out-of-window photo request is possible at all.
   */
  const windowOpen = (conversation.messages || []).some(
    (m: any) =>
      m.direction === "inbound" &&
      new Date(m.created_at).getTime() > Date.now() - 24 * 60 * 60 * 1000
  )

  const socialProvider = req.scope.resolve(
    SOCIAL_PROVIDER_MODULE
  ) as SocialProviderService
  const whatsapp = socialProvider.getWhatsApp(req.scope as any)

  let waMessageId: string | null = null
  let via: "text" | "template" = "text"
  try {
    if (windowOpen) {
      const r: any = await whatsapp.sendTextMessage(conversation.phone_number, text)
      waMessageId = r?.messages?.[0]?.id ?? null
    } else {
      via = "template"
      const r: any = await whatsapp.sendTemplateMessage(
        conversation.phone_number,
        TEMPLATE_NAMES.PARTNER_MESSAGE,
        proseLanguageFor(meta.language) === "english" ? "en" : "hi",
        [{ type: "body", parameters: [{ type: "text", text }] }]
      )
      waMessageId = r?.messages?.[0]?.id ?? null
    }
  } catch (e: any) {
    // The context is NOT stamped. Nothing was asked, so nothing is expected.
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Could not send the photo request, so no context was set: ${e?.message ?? "unknown error"}`
    )
  }

  const now = new Date()
  const photo_context = {
    kind,
    note: (note ?? "").trim() || null,
    set_by: (req as any).auth_context?.actor_id ?? null,
    set_at: now.toISOString(),
    expires_at: resolveContextExpiry(now, ttl_hours),
  }

  await messagingService.updateMessagingConversations({
    id: conversationId,
    metadata: { ...meta, photo_context },
  })

  await messagingService
    .createMessagingMessages({
      conversation_id: conversationId,
      direction: "outbound",
      sender_name: "Admin",
      content: text,
      message_type: via === "template" ? "template" : "text",
      wa_message_id: waMessageId,
      status: "sent",
      metadata: {
        photo_request: true,
        photo_context_kind: kind,
        prose_source: composed.source,
        ...(via === "template"
          ? { template_name: TEMPLATE_NAMES.PARTNER_MESSAGE }
          : {}),
      },
    })
    .catch(() => {
      /* the ask went out and the context is set — an audit row must not fail it */
    })

  res.json({ photo_context, sent: { via, text, wa_message_id: waMessageId } })
}
