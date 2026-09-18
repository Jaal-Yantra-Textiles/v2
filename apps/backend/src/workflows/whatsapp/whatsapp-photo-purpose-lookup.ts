/**
 * #2138 — carrying a photo's stated purpose onto the event the flows read.
 *
 * ## The defect this closes
 *
 * The product-create flow's eligibility rule is:
 *
 *     $trigger.partner_id != null
 *       && ($trigger.type === 'image' || $trigger.type === 'document')
 *       && $trigger.photo_purpose === 'product_submission'
 *
 * 🔴 `photo_purpose` was set NOWHERE. `whatsapp.message_received` is emitted
 * from the webhook with a fixed key set — `from`, `type`, `text`, `caption`,
 * `media_ids`, `media_url`, `partner_id`, `admin_user_id` — and the
 * `visual-flow-event-trigger` subscriber is a pass-through name list that
 * enriches nothing. The condition could never be true.
 *
 * So photo→product creation had been OFF since #2139 replaced the caption rule,
 * and #2143 did not turn it back on: #2143 stamps `photo_context` on the
 * CONVERSATION, and nothing carried it to the EVENT. Nothing errored. A flow
 * that never fires looks exactly like a flow with no eligible input.
 *
 * ## Why the lookup lives here and not in the handler
 *
 * The event is emitted in the webhook, BEFORE the partner handler runs, so the
 * handler's `conversationMeta` does not exist yet. Re-resolving the conversation
 * is the price of the event carrying the truth at the moment it is emitted —
 * and it is paid only for a partner's media message, not for every inbound.
 */

import { MESSAGING_MODULE } from "../../modules/messaging"
import { resolvePhotoPurpose } from "./whatsapp-photo-context-routing"
import type { PhotoContextKind } from "./whatsapp-photo-context"
import { digitsOnly, phoneMatches } from "./whatsapp-phone"

/** Message types that can carry a purpose. Nothing else is a photo. */
const PURPOSEFUL_TYPES = new Set(["image", "document"])

export type PhotoPurposeLookupInput = {
  partnerId: string | null | undefined
  /** The number the message came from, in whatever shape WhatsApp sent it. */
  from: string | null | undefined
  /** `image`, `text`, `interactive`… */
  messageType: string | null | undefined
}

/**
 * PURE: is this message even worth a database lookup?
 *
 * Exported so the decision can be tested without a container, and stated
 * separately because the cost of getting it wrong is a conversation query on
 * every inbound text message in the system.
 */
export function shouldResolvePhotoPurpose(
  input: PhotoPurposeLookupInput
): boolean {
  if (!input.partnerId) return false
  if (!input.from) return false
  return PURPOSEFUL_TYPES.has(String(input.messageType ?? ""))
}

/**
 * The purpose an admin already stated for this partner's photos, or null.
 *
 * Never throws. This runs inside the webhook's fire-and-forget emit: a failed
 * lookup must degrade to "no stated purpose" — which is the pre-existing
 * behaviour and sends the photo down the batch-and-ask path — rather than
 * break inbound message handling for everyone.
 */
export async function findLivePhotoPurpose(
  scope: any,
  input: PhotoPurposeLookupInput
): Promise<PhotoContextKind | null> {
  if (!shouldResolvePhotoPurpose(input)) {
    return null
  }

  try {
    const messagingService: any = scope.resolve(MESSAGING_MODULE)
    if (typeof messagingService?.listMessagingConversations !== "function") {
      return null
    }

    const incoming = digitsOnly(input.from)
    const conversations = await messagingService.listMessagingConversations(
      { partner_id: input.partnerId },
      { take: 50 }
    )

    // Matched on the phone, not "the partner's newest conversation": a partner
    // with two numbers has two conversations, and the context belongs to the
    // one they are actually messaging from.
    const conversation = (conversations || []).find((c: any) =>
      phoneMatches(digitsOnly(c?.phone_number), incoming)
    )
    if (!conversation) return null

    return resolvePhotoPurpose(
      (conversation.metadata as any)?.photo_context ?? null
    )
  } catch {
    // Degrades to "nobody said what these are for", which is the safe answer:
    // the photo joins a batch and the partner gets asked.
    return null
  }
}
