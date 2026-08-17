/**
 * Photo context for the partner assistant.
 *
 * The partner uploads photos a few at a time across several messages and only
 * later says "now make the product from these". That is the whole point of the
 * feature, and it is exactly what the transport makes hard: the client resends
 * its message history as TEXT, and anything the server appended to a previous
 * turn is gone by the next one. Rendering only `body.attachments` would mean
 * the model can see the photos from the current message and nothing before it.
 *
 * So the conversation's photos are reconstructed from the DB instead. Every
 * upload is stamped with `metadata.conversation_id` and lands in the partner's
 * own assistant folder, which makes the folder — not the message history — the
 * source of truth for "what has been shared in this chat".
 *
 * The pure functions are separated from the container-touching one so the merge
 * and render rules can be unit-tested without a DB.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { MEDIA_MODULE } from "../../../../modules/media"
import { assistantFolderSlug } from "../attachments/folder-naming"

export type ChatAttachment = {
  url: string
  name?: string
  mime_type?: string
  media_id?: string
}

/** How many of a conversation's photos to consider. A partner working through a
 *  catalogue can accumulate a lot; the model only needs the recent ones, and an
 *  unbounded list would quietly become the dominant token cost of every turn. */
export const MAX_CONVERSATION_ATTACHMENTS = 24

/**
 * Merge photos recovered from the folder with the ones on this request,
 * de-duplicated by URL and keeping the earliest position of each.
 *
 * Both sources normally contain the same rows — the upload completes before the
 * message is sent — so the merge exists to make either source being empty
 * survivable rather than to combine two distinct sets.
 */
export const mergeAttachments = (
  fromConversation: ChatAttachment[],
  fromBody: ChatAttachment[]
): ChatAttachment[] => {
  const out: ChatAttachment[] = []
  const seen = new Set<string>()
  for (const a of [...fromConversation, ...fromBody]) {
    const url = String(a?.url ?? "").trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ ...a, url })
  }
  return out.slice(-MAX_CONVERSATION_ATTACHMENTS)
}

/**
 * Tell the model the photos EXIST without sending a single pixel.
 *
 * `describe_image` takes a url, so the model can act on a photo it cannot see —
 * but only deliberately, and only when the request actually needs it.
 */
export const renderAttachments = (attachments: ChatAttachment[]): string =>
  [
    "",
    "---",
    `${attachments.length} photo(s) have been shared in this conversation. You CANNOT see them.`,
    "They are listed oldest first. Look at one with `describe_image` only when the request needs it.",
    ...attachments.map(
      (a, i) =>
        `[photo ${i + 1}] name=${a.name ?? "untitled"} type=${
          a.mime_type ?? "unknown"
        } url=${a.url}`
    ),
  ].join("\n")

/**
 * Recover every photo uploaded into this conversation, oldest first.
 *
 * Never throws: losing photo context degrades the answer, but failing the whole
 * chat turn over it would be worse. Returns [] when the partner has never
 * uploaded anything (no folder yet), which is the common case.
 */
export const loadConversationAttachments = async (
  container: MedusaContainer,
  partnerId: string,
  conversationId?: string | null
): Promise<ChatAttachment[]> => {
  if (!conversationId) return []

  try {
    const mediaService: any = container.resolve(MEDIA_MODULE)
    const folders = await mediaService.listFolders({
      slug: assistantFolderSlug(partnerId),
    })
    const folder = folders?.[0]
    if (!folder) return []

    const files = await mediaService.listMediaFiles(
      { folder_id: folder.id },
      { take: 200, order: { created_at: "DESC" } }
    )

    return (files || [])
      .filter(
        (f: any) =>
          String(f?.metadata?.conversation_id ?? "") === String(conversationId)
      )
      .reverse() // listed DESC for the `take` window; the model reads oldest first
      .map((f: any) => ({
        media_id: f.id,
        name: f.original_name || f.file_name,
        mime_type: f.mime_type,
        url: f.file_path,
      }))
      .filter((a: ChatAttachment) => Boolean(a.url))
  } catch (e: any) {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger?.warn?.(
      `[partners/assistant/chat] could not load conversation attachments: ${
        e?.message ?? e
      }`
    )
    return []
  }
}
