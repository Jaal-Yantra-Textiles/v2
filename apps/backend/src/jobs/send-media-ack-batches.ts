import { MedusaContainer } from "@medusajs/framework/types"

import { MESSAGING_MODULE } from "../modules/messaging"
import { SOCIAL_PROVIDER_MODULE } from "../modules/social-provider"
import {
  buildMediaAckText,
  decideMediaAckAction,
  mediaAckAsksConfirmation,
  MEDIA_CTX_NO,
  MEDIA_CTX_YES,
  type MediaAckBatch,
} from "../workflows/whatsapp/whatsapp-media-ack-batch"

/**
 * Acknowledge a settled burst of files ONCE.
 *
 * ## Why a job and not a reply in the webhook
 *
 * The same reason the question is a job: nothing tells us a burst has ended.
 * WhatsApp has no "they are done" signal, so the only evidence is silence, and
 * silence can only be observed by looking again later. The inbound webhook runs
 * once per file and is therefore exactly the wrong place — it is what produced
 * twelve "uploaded to your shared folder" messages for twelve swatches.
 *
 * ## Why this needs no template
 *
 * 🔑 The partner messaged US seconds ago, so Meta's 24-hour customer-service
 * window is open by construction. This is a reply, not an outreach.
 *
 * ## Ordering against `ask-about-photo-batches`
 *
 * Both sweeps run every minute and both may fire for the same conversation.
 * They are deliberately separate messages and this one lands first (25s quiet
 * versus 90s): "got your 12 files" and "what are these for?" are different
 * things to say, and merging them would make the acknowledgement wait on a
 * question the partner may not need asked at all.
 */

export default async function sendMediaAckBatches(container: MedusaContainer) {
  const logger: any = container.resolve("logger")
  const messagingService: any = container.resolve(MESSAGING_MODULE)
  const socialProvider: any = container.resolve(SOCIAL_PROVIDER_MODULE)

  const [conversations] = await messagingService
    .listAndCountMessagingConversations({}, { take: 500 })
    .catch(() => [[], 0])

  let acked = 0
  let waiting = 0

  for (const conv of conversations || []) {
    const meta = (conv?.metadata ?? {}) as Record<string, any>
    const batch = meta.pending_media_ack as MediaAckBatch | undefined

    const decision = decideMediaAckAction(batch)
    if (decision.action === "wait") {
      waiting++
      continue
    }
    if (decision.action !== "ack") {
      continue
    }

    try {
      const wa = socialProvider.getWhatsApp(container as any)
      const text = buildMediaAckText(batch!)
      /**
       * A run WE picked is a guess, so it is stated and asked about: Yes keeps
       * it, No takes the files off the run and asks what they are for. The
       * handler routes these ids (media_ctx_*).
       */
      const guessed = mediaAckAsksConfirmation(batch!)
      if (guessed) {
        await wa.sendInteractiveMessage(conv.phone_number, {
          type: "button",
          body: { text },
          action: {
            buttons: [
              { type: "reply", reply: { id: MEDIA_CTX_YES, title: "✅ Yes" } },
              { type: "reply", reply: { id: MEDIA_CTX_NO, title: "❌ No, not this" } },
            ],
          },
        })
      } else {
        await wa.sendTextMessage(conv.phone_number, text)
      }

      /**
       * 🔴 Stamp `acked_at` only AFTER the send resolves.
       *
       * Stamping first would mark the burst answered on a send that threw, and
       * the partner would be left with no acknowledgement at all — which is
       * the failure this whole path exists to remove. Acknowledging twice is
       * the cheaper mistake.
       *
       * Re-read first: the webhook may have added a file to this batch while
       * the send was in flight, and writing our snapshot back would drop it.
       */
      const fresh = await messagingService
        .retrieveMessagingConversation(conv.id)
        .catch(() => null)
      const freshMeta = (fresh?.metadata ?? meta) as Record<string, any>
      const freshBatch = (freshMeta.pending_media_ack ?? batch) as MediaAckBatch

      await messagingService.updateMessagingConversations({
        id: conv.id,
        metadata: {
          ...freshMeta,
          pending_media_ack: { ...freshBatch, acked_at: new Date().toISOString() },
          // What a "❌ No" undoes. Replaced by the next guess, never merged.
          ...(guessed
            ? { pending_media_context: { ...guessed, asked_at: new Date().toISOString() } }
            : {}),
        },
      })
      acked++
    } catch (e: any) {
      // One partner's failed send must not stop the sweep for everyone else.
      logger.warn(
        `[media-ack] could not acknowledge ${conv?.phone_number}: ${e?.message ?? "unknown"}`
      )
    }
  }

  if (acked || waiting) {
    logger.info(`[media-ack] acked=${acked} still_receiving=${waiting}`)
  }
}

export const config = {
  name: "send-media-ack-batches",
  // Every minute. The quiet window is 25s, so a burst is acknowledged within
  // about a minute and a quarter of the last file — close enough to read as a
  // reply, and a coarser schedule would feel like being ignored.
  schedule: "* * * * *",
}
