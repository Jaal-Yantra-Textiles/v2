import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { MESSAGING_MODULE } from "../../../../modules/messaging"
import { downloadAndSaveWhatsAppMedia } from "../../../../workflows/whatsapp/whatsapp-media-helper"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Re-fetch inbound WhatsApp media whose stored URL is Meta's, not ours.
 *
 * ## What went wrong
 *
 * `messaging_message.media_url` is written at row-creation time with the
 * `lookaside.fbsbx.com` URL Meta puts in the webhook, and is meant to be
 * overwritten with our own once the bytes are downloaded. Two paths left it
 * un-overwritten:
 *
 *   1. **The consent gate returned first.** It sits before the media branch, so
 *      anything sent before the partner agreed was never downloaded. On
 *      2026-08-25 ten photographs from Bhagalpur Handloom SHG arrived in a
 *      two-second burst twenty-eight seconds before consent was recorded.
 *   2. **A newest-row race.** The post-download update matched "the newest row
 *      in this conversation" against the message being handled; in a burst the
 *      newest row is usually a different photograph, so the update silently
 *      landed nowhere.
 *
 * Both are fixed forward. This is for the rows already written.
 *
 * ## 🔴 Why it is urgent
 *
 * A lookaside URL 401s without a bearer token AND carries an `ext=` expiry
 * about five minutes out, so those rows have been broken thumbnails since
 * minutes after they arrived. Meta retains the underlying media about **30
 * days** — after that the photographs are gone for good. This job is worth
 * running promptly and worth nothing at all a month late.
 *
 * ## Where the id comes from
 *
 * `media_id` is a real column now, but rows written before it exists have only
 * the URL — which embeds `mid=<id>`. That is parsed as a FALLBACK, and only as
 * one: Meta may reshape the URL whenever it likes, and a parser is not a
 * schema. Anything with neither is reported, not guessed at.
 */

/** Hard cap per call — bounds both blast radius and Meta API spend. */
export const MAX_MEDIA_RECOVERY_SCAN = 500

const paramsSchema = z.object({
  /** Restrict to one conversation (default: every conversation). */
  conversation_id: z.string().min(1).optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_MEDIA_RECOVERY_SCAN)
    .optional()
    .default(100),
})

/**
 * PURE: is this row holding a URL only Meta can serve?
 *
 * Matched on the HOST, not on the presence of "fbsbx" anywhere in the string —
 * a URL of ours that happened to contain that substring (a filename, a query
 * parameter) would otherwise be re-fetched and overwritten.
 */
export function isUnrecoveredMetaMediaUrl(url: unknown): boolean {
  const value = String(url ?? "").trim()
  if (!value) return false
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === "lookaside.fbsbx.com" || host.endsWith(".fbsbx.com")
  } catch {
    return false
  }
}

/**
 * PURE: the Meta media id for a row.
 *
 * The column first — it is the recorded fact. The URL's `mid=` only when there
 * is no column value, because parsing a third party's URL shape is a guess that
 * happens to work today.
 */
export function resolveMetaMediaId(row: {
  media_id?: string | null
  media_url?: string | null
}): string | null {
  const stored = String(row?.media_id ?? "").trim()
  if (stored) return stored

  const url = String(row?.media_url ?? "").trim()
  if (!url) return null
  try {
    const mid = new URL(url).searchParams.get("mid")
    const trimmed = String(mid ?? "").trim()
    return trimmed || null
  } catch {
    return null
  }
}

export const recoverWhatsappMediaJob: MaintenanceJob = {
  id: "recover-whatsapp-media",
  label: "Re-download inbound WhatsApp media still pointing at Meta",
  description:
    `Re-fetch inbound WhatsApp photographs whose messaging_message.media_url is still Meta's lookaside.fbsbx.com URL rather than ours. Those URLs 401 without a bearer token and expire about FIVE MINUTES after the message arrives, so every such row has been a broken thumbnail since shortly after it was received. Two paths produced them: the consent gate returns before the media branch runs (so anything sent before a partner agreed was never downloaded), and a newest-row race in the post-download update meant a burst of photos updated the wrong row or none. Both are fixed forward; this repairs the rows already written. 🔴 TIME-LIMITED: Meta retains the underlying media about 30 days, after which the photographs cannot be recovered at all. The media id is read from the media_id column, falling back to parsing mid= out of the stored URL for rows written before that column existed; a row with neither is reported rather than guessed at. Dry-run lists every row it would re-fetch WITHOUT calling Meta. Scans up to 'limit' rows per call (default 100, max ${MAX_MEDIA_RECOVERY_SCAN}).`,
  params: [
    {
      name: "conversation_id",
      type: "string",
      required: false,
      description: "Restrict to a single conversation (default: all)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max rows to scan in one call (default 100, max ${MAX_MEDIA_RECOVERY_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { conversation_id, limit } = parsed.data

    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const messagingService: any = container.resolve(MESSAGING_MODULE)

    const filters: Record<string, unknown> = { message_type: "media", direction: "inbound" }
    if (conversation_id) filters.conversation_id = conversation_id

    const rows: any[] = await messagingService.listMessagingMessages(filters, {
      take: limit,
      order: { created_at: "DESC" },
    })

    /**
     * The owning partner per conversation.
     *
     * 🔴 Needed because `downloadAndSaveWhatsAppMedia` files the photograph in
     * that PARTNER's folder. Passing the conversation id in the partner slot
     * would have created a folder named after a conversation — the file would
     * exist, and be exactly as unattributable as the WhatsApp inbox this whole
     * feature was built to escape.
     */
    const conversationIds = [
      ...new Set(rows.map((r) => r?.conversation_id).filter(Boolean)),
    ]
    const conversations: any[] = conversationIds.length
      ? await messagingService.listMessagingConversations({
          id: conversationIds,
        })
      : []
    const partnerByConversation = new Map<string, string>(
      conversations
        .filter((c: any) => c?.id && c?.partner_id)
        .map((c: any) => [c.id, c.partner_id])
    )

    /**
     * Filtered in memory rather than by a `like` on the URL: the module service
     * has no operator for it, and a hand-rolled SQL predicate on a third
     * party's URL shape is the same guess this job exists to avoid.
     */
    const stale = rows.filter((r) => isUnrecoveredMetaMediaUrl(r?.media_url))

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let recovered = 0

    for (const row of stale) {
      const mediaId = resolveMetaMediaId(row)
      if (!mediaId) {
        errors.push({
          id: row.id,
          message:
            "No media_id on the row and no mid= in the stored URL — this photograph cannot be recovered.",
        })
        continue
      }

      const partnerId = partnerByConversation.get(row.conversation_id)
      if (!partnerId) {
        // Refuse rather than file it somewhere plausible. A photograph in the
        // wrong partner's folder is worse than one still missing: it is
        // evidence attributed to someone who did not send it.
        errors.push({
          id: row.id,
          message: `Conversation ${row.conversation_id} has no partner_id — refusing to file this photograph against a guess.`,
        })
        continue
      }

      if (dry_run) {
        changes.push({
          entity: "messaging_message",
          id: row.id,
          field: `media_url (media_id ${mediaId}, partner ${partnerId})`,
          before: row.media_url,
          after: "would re-fetch from Meta",
        })
        continue
      }

      try {
        /**
         * 🔴 `mediaUrl` is deliberately NOT passed. The stored one is the dead
         * lookaside URL; handing it over would make the helper try it, fail,
         * and report a failure that looks like Meta losing the media rather
         * than us sending a stale URL. Omitting it makes the helper mint a
         * fresh one from the id, which is the whole point.
         */
        const saved = await downloadAndSaveWhatsAppMedia(container as any, {
          mediaId,
          mimeType: row.media_mime_type || undefined,
          partnerId,
          partnerName: row.sender_name || "WhatsApp",
        })

        if (!saved?.fileUrl) {
          errors.push({
            id: row.id,
            message: `Meta returned nothing for media ${mediaId} — most likely past the ~30-day retention window.`,
          })
          continue
        }

        await messagingService.updateMessagingMessages({
          id: row.id,
          media_url: saved.fileUrl,
          media_mime_type: saved.mimeType,
          media_id: mediaId,
          media_pending_reason: null,
        })

        changes.push({
          entity: "messaging_message",
          id: row.id,
          field: "media_url",
          before: row.media_url,
          after: saved.fileUrl,
        })
        recovered++
      } catch (e: any) {
        errors.push({ id: row.id, message: e?.message ?? String(e) })
        logger?.warn?.(
          `[recover-whatsapp-media] ${row.id} (media ${mediaId}) failed: ${e?.message ?? e}`
        )
      }
    }

    const summary = dry_run
      ? `Would re-fetch ${changes.length} of ${stale.length} stale media row(s) (${rows.length} inbound media scanned)${
          errors.length ? `; ${errors.length} cannot be recovered` : ""
        }.`
      : `Recovered ${recovered} of ${stale.length} stale media row(s) (${rows.length} inbound media scanned)${
          errors.length ? `; ${errors.length} failed` : ""
        }.`

    return {
      job_id: "recover-whatsapp-media",
      dry_run,
      applied: !dry_run && recovered > 0,
      summary,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
