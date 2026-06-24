import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

import { FEEDBACK_MODULE } from "../../../../modules/feedback";
import type FeedbackService from "../../../../modules/feedback/service";
import { listAllMediasWorkflow } from "../../../../workflows/media/list-all-medias";
import { listAlbumMediaWorkflow } from "../../../../workflows/media/list-album-media";
import { listMediaFileWorkflow } from "../../../../workflows/media/list-media-file";
import {
  ArtworkChoice,
  buildArtworkPickUpdate,
  mapMediaToArtworkChoice,
  normalizeRatingValue,
  resolveArtworkSourceId,
  selectArtworkChoices,
} from "../../../../workflows/feedback/lib/artwork-feedback";

const ARTWORK_COUNT = 3;
const POOL_TAKE = 100;

/**
 * Fetch the pool of public artwork images the seeded selector draws from.
 *
 * - DEFAULT (`sourceId` null): the GENERAL public-image pool — the same source
 *   the media randomiser (`GET /web/media`) uses — so the feature works against
 *   whatever media exists, with no curated album required.
 * - OVERRIDE (`sourceId` set via `FEEDBACK_ARTWORK_ALBUM_ID`): scoped to that
 *   Album first (AlbumMedia → MediaFile), falling back to a media FOLDER id —
 *   mirroring the album-vs-folder resolution in `GET /web/media`.
 *
 * Stable order (no DB-side randomisation); the per-token variation is applied by
 * the pure `selectArtworkChoices` seeded selector. An empty pool degrades the
 * page to a plain rating (caller returns `artworks: []`).
 */
async function fetchArtworkPool(
  req: MedusaRequest,
  sourceId: string | null
): Promise<ArtworkChoice[]> {
  let mediaFiles: any[] = [];

  if (!sourceId) {
    // General public-image pool via the media randomiser source. `file_type`
    // (not `type`) is the column the media workflows whitelist server-side.
    try {
      const { result } = await listAllMediasWorkflow(req.scope).run({
        input: {
          filters: { is_public: true, file_type: "image" },
          config: { take: POOL_TAKE, skip: 0 },
        },
      });
      mediaFiles = ((result as any)?.media_files ?? []) as any[];
    } catch {
      mediaFiles = [];
    }
    return mediaFiles.map((m: any) => mapMediaToArtworkChoice(m));
  }

  try {
    const { result } = await listAlbumMediaWorkflow(req.scope).run({
      input: {
        filters: { album: sourceId } as any,
        config: { take: POOL_TAKE, skip: 0, relations: ["media"] },
      },
    });
    const rows = (result as any)?.[0] ?? [];
    mediaFiles = rows
      .map((r: any) => r?.media)
      .filter((m: any) => m && m.is_public !== false && m.file_type === "image");
  } catch {
    mediaFiles = [];
  }

  if (!mediaFiles.length) {
    try {
      const { result } = await listMediaFileWorkflow(req.scope).run({
        input: {
          filters: { folder_id: sourceId, is_public: true, file_type: "image" },
          config: { take: POOL_TAKE, skip: 0 },
        },
      });
      mediaFiles = ((result as any)?.[0] ?? []) as any[];
    } catch {
      mediaFiles = [];
    }
  }

  return mediaFiles.map((m: any) => mapMediaToArtworkChoice(m));
}

/**
 * Public, token-less feedback page payload (the token IS the feedback id, as in
 * the post-delivery email link `${STORE_URL}/feedback/:id`). Returns the
 * feedback request plus a small set of artwork images to pick from. Additive:
 * if no artwork pool is configured, `artworks` is simply empty and the page
 * falls back to a plain 1..5 rating.
 *
 * GET /web/feedback/:id
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const service = req.scope.resolve(FEEDBACK_MODULE) as FeedbackService;

  const rows = await service.listFeedbacks({ id });
  const feedback = Array.isArray(rows) ? rows[0] : null;
  if (!feedback) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Feedback not found");
  }

  const sourceId = resolveArtworkSourceId(process.env);
  const pool = await fetchArtworkPool(req, sourceId);
  const artworks = selectArtworkChoices(pool, id, ARTWORK_COUNT);

  res.status(200).json({
    feedback: {
      id: feedback.id,
      rating: feedback.rating,
      status: feedback.status,
      comment: feedback.comment ?? null,
      chosen_artwork_id: feedback.chosen_artwork_id ?? null,
      artwork_affinity: feedback.artwork_affinity ?? null,
    },
    artworks,
  });
};

/**
 * Record the customer's feedback from the page: the optional 1..5 rating, an
 * optional comment, and the optional artwork pick. Every field is optional and
 * additive — the artwork pick never replaces the rating. The chosen artwork is
 * validated against the SAME seeded set the GET returns, so an arbitrary id
 * can't be recorded.
 *
 * POST /web/feedback/:id  { rating?, comment?, artwork_id?, affinity? }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const body = (req.body || {}) as Record<string, any>;
  const service = req.scope.resolve(FEEDBACK_MODULE) as FeedbackService;
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  const rows = await service.listFeedbacks({ id });
  const feedback = Array.isArray(rows) ? rows[0] : null;
  if (!feedback) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Feedback not found");
  }

  const update: Record<string, any> = { id };

  const rating = normalizeRatingValue(body.rating);
  if (rating) {
    update.rating = rating;
  }
  if (typeof body.comment === "string" && body.comment.trim().length) {
    update.comment = body.comment.trim();
  }

  let pickRejected = false;
  const artworkId =
    typeof body.artwork_id === "string" && body.artwork_id.trim().length
      ? body.artwork_id.trim()
      : null;

  if (artworkId) {
    const sourceId = resolveArtworkSourceId(process.env);
    const pool = await fetchArtworkPool(req, sourceId);
    const offeredIds = selectArtworkChoices(pool, id, ARTWORK_COUNT).map(
      (a) => a.id
    );
    const pick = buildArtworkPickUpdate({
      feedbackId: id,
      artworkId,
      affinity: body.affinity,
      offeredIds,
      existingMetadata: (feedback.metadata as any) ?? null,
    });
    if (pick) {
      update.chosen_artwork_id = pick.chosen_artwork_id;
      update.artwork_affinity = pick.artwork_affinity;
      update.metadata = pick.metadata;
    } else {
      pickRejected = true;
      logger.warn(
        `Feedback ${id}: artwork pick ${artworkId} rejected (not among offered set)`
      );
    }
  }

  // Nothing valid to record — surface a 400 rather than a silent no-op.
  const hasMutation = Object.keys(update).length > 1;
  if (!hasMutation) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      pickRejected
        ? "Selected artwork was not among the offered set"
        : "No valid rating, comment or artwork pick supplied"
    );
  }

  await service.updateFeedbacks(update);
  const refreshed = (await service.listFeedbacks({ id }))?.[0] ?? null;

  res.status(200).json({
    feedback: refreshed && {
      id: refreshed.id,
      rating: refreshed.rating,
      status: refreshed.status,
      comment: refreshed.comment ?? null,
      chosen_artwork_id: refreshed.chosen_artwork_id ?? null,
      artwork_affinity: refreshed.artwork_affinity ?? null,
    },
    artwork_pick_rejected: pickRejected,
  });
};
