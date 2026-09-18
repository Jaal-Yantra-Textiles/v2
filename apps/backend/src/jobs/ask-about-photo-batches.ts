import { MedusaContainer } from "@medusajs/framework/types"

import { MESSAGING_MODULE } from "../modules/messaging"
import { SOCIAL_PROVIDER_MODULE } from "../modules/social-provider"
import {
  buildPhotoQuestionPurpose,
  decidePhotoBatchAction,
  type PhotoBatch,
} from "../workflows/whatsapp/whatsapp-photo-batch"
import { composeOutreachText } from "../workflows/whatsapp/whatsapp-outreach-prose"
import { proseLanguageFor } from "../workflows/whatsapp/whatsapp-reminder-prose"

/**
 * #2138 — ask what a settled burst of photos is for.
 *
 * ## Why a job and not a reply in the webhook
 *
 * The question must come AFTER the partner has stopped sending, and nothing
 * tells us a burst has ended — WhatsApp has no "they are done" signal. The only
 * available evidence is silence, and silence can only be observed by looking
 * again later. The inbound webhook, which runs once per photo, is exactly the
 * wrong place: it would ask eight times for eight photos, which is worse than
 * the guessing this replaces.
 *
 * So the webhook only RECORDS each photo into the conversation's batch, and
 * this sweep asks once, when the batch has settled.
 *
 * ## Why this can be free-form text and needs no template
 *
 * 🔑 The partner messaged US moments ago, so Meta's 24-hour customer-service
 * window is open by construction — this is a reply, not an outreach. That is
 * what makes the whole feature possible without a template approval: the
 * question can be written for the moment instead of assembled from a fixed
 * string, and it can be in the language they actually use.
 *
 * A batch that somehow ages past the window would be refused by Meta; the send
 * is best-effort per conversation and one refusal must not stop the sweep.
 */

const BUSINESS_NAME = process.env.WHATSAPP_BUSINESS_NAME || "JYT Textiles"

export default async function askAboutPhotoBatches(container: MedusaContainer) {
  const logger: any = container.resolve("logger")
  const messagingService: any = container.resolve(MESSAGING_MODULE)
  const socialProvider: any = container.resolve(SOCIAL_PROVIDER_MODULE)

  const [conversations] = await messagingService
    .listAndCountMessagingConversations({}, { take: 500 })
    .catch(() => [[], 0])

  let asked = 0
  let waiting = 0

  for (const conv of conversations || []) {
    const meta = (conv?.metadata ?? {}) as Record<string, any>
    const batch = meta.pending_photo_batch as PhotoBatch | undefined

    const decision = decidePhotoBatchAction(batch)
    if (decision.action === "wait") {
      waiting++
      continue
    }
    if (decision.action !== "ask") {
      continue
    }

    try {
      const composed = await composeOutreachText(container as any, {
        partner_name: conv.title || "there",
        business_name: BUSINESS_NAME,
        purpose: buildPhotoQuestionPurpose({ photos: decision.photos }),
        // The language they chose at registration (#2130), not one inferred
        // from button taps — those carry our words, not theirs.
        language: proseLanguageFor(meta.language),
      })

      const wa = socialProvider.getWhatsApp(container as any)
      await wa.sendTextMessage(conv.phone_number, composed.text)

      /**
       * 🔴 Stamp `asked_at` only AFTER the send resolves.
       *
       * Stamping first would mean a send that throws still marks the batch
       * asked, and the partner is left with photos nobody ever responded to —
       * the silent half of the failure, which is the one they notice.
       */
      await messagingService.updateMessagingConversations({
        id: conv.id,
        metadata: {
          ...meta,
          pending_photo_batch: { ...batch, asked_at: new Date().toISOString() },
        },
      })

      asked++
      logger.info(
        `[photo-batch] asked ${conv.phone_number} about ${decision.photos} photo(s) ` +
          `(${decision.reason}, prose=${composed.source})`
      )
    } catch (e: any) {
      // One partner's failed send must not stop the sweep for everyone else.
      logger.warn(
        `[photo-batch] could not ask ${conv?.phone_number}: ${e?.message ?? "unknown"}`
      )
    }
  }

  if (asked || waiting) {
    logger.info(`[photo-batch] asked=${asked} still_receiving=${waiting}`)
  }
}

export const config = {
  name: "ask-about-photo-batches",
  // Every minute. The quiet window is 90s, so this adds at most ~60s of extra
  // delay before the question lands — a partner who has just put their phone
  // down does not notice a minute, and a coarser schedule would feel like
  // being ignored.
  schedule: "* * * * *",
}
