import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_CAPABILITY_MODULE } from "../../../modules/partner_capability"
import { getPartnerFromAuthContext } from "../helpers"
import { resolveMediaFiles } from "../media-urls"
import type {
  PartnerListCapabilitySamplesQuery,
  PartnerPostCapabilitySampleReq,
} from "../inquiries/validators"

/**
 * The partner's own capability library (#1531 slice 2).
 *
 * A sample deliberately OUTLIVES the inquiry that produced it: the inquiry is
 * an event, this is the library it deposits into. That is what stops the same
 * partner being asked the same question next year — and it is why these routes
 * are here, beside the wizard, rather than inside it.
 *
 * 🔴 `partner_id` is stamped from the auth context on write and filtered by it
 * on read, in both directions, always. The library is shared across every
 * partner on the platform; a read that forgot the filter would show a weaver
 * what their competitors have on the loom this week, which is commercially the
 * most sensitive thing in the table. Same shape as #1496.
 */

/** A ceiling on one partner's library page, not pagination. */
const MAX_CAPABILITY_PAGE = 100

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const service: any = req.scope.resolve(PARTNER_CAPABILITY_MODULE)
  const validated = ((req as any).validatedQuery ||
    req.query ||
    {}) as PartnerListCapabilitySamplesQuery

  const filters: Record<string, unknown> = { partner_id: partner.id }
  if (validated.technique) filters.technique = validated.technique
  if (validated.material) filters.material = validated.material

  const [samples, count] = await service.listAndCountPartnerCapabilitySamples(
    filters as any,
    {
      order: { captured_at: "DESC" },
      take: Math.min(Number(validated.limit ?? 20), MAX_CAPABILITY_PAGE),
      skip: Number(validated.offset ?? 0),
    }
  )

  const withMedia = await attachMediaUrls(req.scope, samples ?? [])

  return res.json({ samples: withMedia, count })
}

/**
 * Attach renderable `media` to each sample.
 *
 * 🔴 Without this the library is WRITE-ONLY. The row stores `media_file_ids`,
 * the wizard gets `{ id, url }` back from its own upload and happily renders
 * the photo it just chose — and then the partner reloads and every attachment
 * is an empty square, because an id is not a URL and nothing on the read path
 * ever turned one into the other. That failure appears only after a refresh,
 * which is exactly the moment nobody tests.
 *
 * See `resolveMediaFiles`: the moodboard had the identical defect.
 */
const attachMediaUrls = async (scope: any, samples: any[]): Promise<any[]> =>
  Promise.all(
    samples.map(async (s) => ({
      ...s,
      media: await resolveMediaFiles(
        scope,
        Array.isArray(s?.media_file_ids) ? s.media_file_ids : []
      ),
    }))
  )

/**
 * POST /partners/capabilities — record something they have actually made.
 *
 * 🔑 `captured_at` defaults to now and SAYS SO in the response. It is not
 * `created_at`: a photo typed up three weeks after it was taken describes a
 * capability that may already be gone, and the library is only worth searching
 * if it admits how stale each row is. Defaulting silently would make every
 * back-filled row look fresh.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<PartnerPostCapabilitySampleReq>,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const body = ((req as any).validatedBody ||
    req.body) as PartnerPostCapabilitySampleReq

  const service: any = req.scope.resolve(PARTNER_CAPABILITY_MODULE)

  const capturedAt = body.captured_at ? new Date(body.captured_at) : new Date()

  const sample = await service.createPartnerCapabilitySamples({
    // Never from the body. See the header.
    partner_id: partner.id,
    title: body.title,
    technique: body.technique ?? null,
    material: body.material ?? null,
    media_file_ids: body.media_file_ids?.length ? body.media_file_ids : null,
    notes: body.notes ?? null,
    source: "wizard",
    captured_at: capturedAt,
  } as any)

  // Resolved here too, so a caller rendering from the create response and one
  // rendering from the listing see the SAME shape. Two shapes for one row is
  // how a `media` key ends up read as `media_files` on one screen and silently
  // renders nothing.
  const [withMedia] = await attachMediaUrls(req.scope, [sample])

  return res.status(201).json({
    sample: withMedia ?? sample,
    captured_at_defaulted: !body.captured_at,
  })
}
