/**
 * The folder a partner's capability photographs land in.
 *
 * `partner_capability_sample.media_file_ids` says "media_file ids", and it
 * means it: a photograph that proves a partner can weave kani has to be
 * findable in six months, when exactly that fabric is wanted again. The
 * pre-existing `/partners/medias/uploads/*` pair puts objects at the BUCKET
 * ROOT and writes no media record, so a photo uploaded that way is
 * unattributable the moment the request ends — which is the state the
 * WhatsApp inbox was already in and the whole reason this table exists.
 *
 * 🔑 A SEPARATE folder from the assistant's, not a shared "partner uploads"
 * one. The two have different lifetimes and different meanings: an assistant
 * attachment is context for one conversation, a capability sample is a
 * library entry that deliberately outlives the inquiry that produced it.
 * Pooling them would make the library unbrowsable within a season.
 *
 * The ensure/slug/link mechanics are the assistant folder's, deliberately —
 * `linkFolderToPartnerPeople` is imported rather than copied, because the two
 * copies would drift the first time the access model changed.
 */
import type { MedusaContainer } from "@medusajs/framework/types"

import { MEDIA_MODULE } from "../../../../modules/media"
import {
  linkFolderToPartnerPeople,
  type PartnerLike,
} from "../../assistant/attachments/folder"

/** Marker on folder.metadata, so ownership survives without the person link. */
export const PARTNER_CAPABILITY_FOLDER_PURPOSE = "partner_capability_samples"

/**
 * Deterministic slug, derived from the partner ID and not the name.
 *
 * `folder.slug` is UNIQUE and two partners can share a display name while one
 * of them may rename itself later; an id-derived slug is stable across both,
 * and it is the lookup key for "does this partner already have a folder?", so
 * deriving it differently in two places would silently accumulate folders.
 */
export const capabilityFolderSlug = (partnerId: string): string =>
  `partner-capabilities-${String(partnerId).trim()}`

export const capabilityFolderName = (partnerName?: string | null): string => {
  const trimmed = String(partnerName ?? "").trim()
  return trimmed ? `Capability samples — ${trimmed}` : "Capability samples"
}

export const capabilityFolderPath = (partnerId: string): string =>
  `/${capabilityFolderSlug(partnerId)}`

/**
 * The folder id, creating it on first use. Idempotent: on a unique-slug
 * collision the folder is re-read rather than the upload being failed, so two
 * photos picked at once converge on one folder instead of racing.
 */
export const ensurePartnerCapabilityFolder = async (
  container: MedusaContainer,
  partner: PartnerLike
): Promise<string> => {
  const mediaService: any = container.resolve(MEDIA_MODULE)
  const slug = capabilityFolderSlug(partner.id)

  const existing = await mediaService.listFolders({ slug })
  if (existing?.length) {
    return existing[0].id
  }

  let folder: any
  try {
    folder = await mediaService.createFolders({
      name: capabilityFolderName(partner.name),
      slug,
      description:
        "Photographs of what this partner has actually made, evidencing their capability answers.",
      path: capabilityFolderPath(partner.id),
      level: 0,
      is_public: false,
      metadata: {
        partner_id: partner.id,
        purpose: PARTNER_CAPABILITY_FOLDER_PURPOSE,
      },
    })
  } catch (e: any) {
    const retry = await mediaService.listFolders({ slug })
    if (retry?.length) return retry[0].id
    throw e
  }

  await linkFolderToPartnerPeople(container, partner.id, folder.id)
  return folder.id
}
