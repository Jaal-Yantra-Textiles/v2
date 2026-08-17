/**
 * Resolve (and create on first use) the folder that assistant attachments land
 * in for a given partner.
 *
 * Why a folder at all: the pre-existing `/partners/medias/uploads/*` flow puts
 * objects at the BUCKET ROOT and writes no media record — the file exists, but
 * nothing in the platform knows whose it is or what it was for. Everything
 * uploaded through the assistant goes into a partner-owned folder instead, so
 * a photo can be found again from the media UI after the chat is gone.
 *
 * Ownership is recorded TWICE, deliberately:
 *   - `folder.metadata.partner_id` — the authoritative marker. Works even for a
 *     partner with no linked people, which is the common case for a fresh
 *     partner and would otherwise leave them unable to upload at all.
 *   - a person→folder link for each of the partner's people — this is what
 *     `verifyFolderAccess` and the shared-folders listing read, so the folder
 *     shows up in the UI the partner already has.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { MEDIA_MODULE } from "../../../../modules/media"
import { PERSON_MODULE } from "../../../../modules/person"
import {
  PARTNER_ASSISTANT_FOLDER_PURPOSE,
  assistantFolderName,
  assistantFolderPath,
  assistantFolderSlug,
} from "./folder-naming"

export type PartnerLike = { id: string; name?: string | null }

/**
 * Returns the folder id for this partner's assistant uploads, creating the
 * folder the first time it is needed. Idempotent: the slug is unique and
 * derived from the partner id, so concurrent first-uploads converge on one
 * folder rather than racing to create two.
 */
export const ensurePartnerAssistantFolder = async (
  container: MedusaContainer,
  partner: PartnerLike
): Promise<string> => {
  const mediaService: any = container.resolve(MEDIA_MODULE)
  const slug = assistantFolderSlug(partner.id)

  const existing = await mediaService.listFolders({ slug })
  if (existing?.length) {
    return existing[0].id
  }

  let folder: any
  try {
    folder = await mediaService.createFolders({
      name: assistantFolderName(partner.name),
      slug,
      description: "Photos shared with the partner assistant.",
      path: assistantFolderPath(partner.id),
      level: 0,
      is_public: false,
      metadata: {
        partner_id: partner.id,
        purpose: PARTNER_ASSISTANT_FOLDER_PURPOSE,
      },
    })
  } catch (e: any) {
    // Unique-slug collision: another request created it between our read and
    // our write. Re-read rather than failing the upload.
    const retry = await mediaService.listFolders({ slug })
    if (retry?.length) return retry[0].id
    throw e
  }

  await linkFolderToPartnerPeople(container, partner.id, folder.id)
  return folder.id
}

/**
 * Best-effort: make the folder visible in the partner's existing shared-folders
 * screen, which resolves access through partner → people → folders.
 *
 * Never throws. A partner with no linked people still gets a working folder —
 * it just isn't listed by that particular screen — and failing the photo upload
 * over a listing concern would be the wrong trade.
 */
export const linkFolderToPartnerPeople = async (
  container: MedusaContainer,
  partnerId: string,
  folderId: string
): Promise<void> => {
  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "partners",
      fields: ["people.id"],
      filters: { id: partnerId },
    })

    const peopleIds: string[] = ((data?.[0] as any)?.people || [])
      .map((p: any) => p?.id)
      .filter(Boolean)
    if (!peopleIds.length) return

    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    for (const personId of peopleIds) {
      await remoteLink.create({
        [PERSON_MODULE]: { person_id: personId },
        [MEDIA_MODULE]: { folder_id: folderId },
      })
    }
  } catch (e: any) {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger?.warn?.(
      `[partner-assistant/attachments] could not link folder ${folderId} to partner ${partnerId} people: ${
        e?.message ?? e
      }`
    )
  }
}
