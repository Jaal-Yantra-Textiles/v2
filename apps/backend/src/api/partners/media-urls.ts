/**
 * Turn `media_file` ids into something a browser can actually show.
 *
 * 🔴 Two partner-facing surfaces stored ids and served ids, which is
 * write-only: an id is not a URL, and nothing on either read path ever turned
 * one into the other.
 *
 *   · `partner_capability_sample.media_file_ids` — the partner uploads a
 *     photograph, sees it (the upload response carries the URL), reloads, and
 *     every attachment is an empty square.
 *   · `design_inquiry.reference_media_ids` — the MOODBOARD. A designer attaches
 *     the references that explain what they are asking for, the route returns
 *     the ids, and the partner is asked "can you make this?" while being shown
 *     nothing at all (#1543).
 *
 * Both failures are invisible from the write side and appear only on a screen,
 * which is why one shared resolver rather than two: the next surface that
 * stores media ids should not have to rediscover this.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { MEDIA_MODULE } from "../../modules/media"

export type ResolvedMedia = {
  id: string
  url: string
  name?: string | null
  type?: string | null
}

/**
 * Best-effort, and deliberately so: a media row that has been deleted yields no
 * entry rather than failing the whole listing. A library that still opens with
 * one photograph missing is worth more than one that refuses to open, and the
 * id list still records that something was attached.
 *
 * Order follows the ids as given — the sequence a moodboard was assembled in is
 * part of what it says.
 */
export const resolveMediaFiles = async (
  scope: any,
  ids: Array<string | null | undefined> | null | undefined
): Promise<ResolvedMedia[]> => {
  const wanted = (ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean)
  if (!wanted.length) return []

  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const mediaService: any = scope.resolve(MEDIA_MODULE)
    const files = await mediaService.listMediaFiles({ id: [...new Set(wanted)] })
    const byId = new Map((files ?? []).map((f: any) => [f.id, f]))

    return wanted
      .map((id) => {
        const file: any = byId.get(id)
        // No `file_path` means nothing renderable. Dropping it beats emitting
        // `url: undefined`, which every consumer would faithfully put in an
        // <img src> and display as a broken image.
        if (!file?.file_path) return null
        return {
          id: file.id,
          url: file.file_path,
          name: file.original_name || file.file_name,
          type: file.mime_type,
        }
      })
      .filter(Boolean) as ResolvedMedia[]
  } catch (e: any) {
    logger?.warn?.(
      `[partners] could not resolve media urls for ${wanted.length} id(s): ${e?.message ?? e}`
    )
    return []
  }
}
