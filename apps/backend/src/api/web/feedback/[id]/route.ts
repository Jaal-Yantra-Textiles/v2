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
  resolveArtworkSourceId,
  selectArtworkChoices,
} from "../../../../workflows/feedback/lib/artwork-feedback";
import {
  buildPublicFeedbackView,
  isBuyerFeedbackRequest,
  isFeedbackAnswered,
  parseFeedbackSubmission,
} from "../../../../workflows/feedback/lib/feedback-page";
import { resolveFeedbackStoreForOrder } from "../../../../workflows/feedback/lib/resolve-feedback-store";

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
 * Load a BUYER feedback request (one tied to an order). Any other feedback row
 * (partner/task/admin feedback lives in the same table) is a 404 here, so a
 * public link can never read or overwrite it.
 */
async function loadBuyerFeedback(req: MedusaRequest, id: string) {
  const service = req.scope.resolve(FEEDBACK_MODULE) as FeedbackService;
  const rows = await service.listFeedbacks({ id });
  const feedback: any = Array.isArray(rows) ? rows[0] : null;
  if (!feedback || !isBuyerFeedbackRequest(feedback)) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Feedback not found");
  }
  return { service, feedback };
}

/** What was ordered — titles/thumbnails only, never the buyer's details. */
async function loadOrderSummary(req: MedusaRequest, orderId: string) {
  try {
    const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "sales_channel_id",
        "items.title",
        "items.product_title",
        "items.variant_title",
        "items.thumbnail",
        "items.quantity",
      ],
      filters: { id: orderId },
    });
    return (data?.[0] as any) ?? null;
  } catch {
    return null;
  }
}

/**
 * Public feedback page payload. The feedback id IS the credential (a ULID, as
 * in the email link `<shop>/feedback/:id`). Returns whether it was already
 * answered, what was ordered, which shop it belongs to, and a small seeded set
 * of artwork to pick from (empty when no media → the page shows plain stars).
 *
 * GET /web/feedback/:id
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const { feedback } = await loadBuyerFeedback(req, id);

  const order = await loadOrderSummary(req, feedback.order_id);
  const store = await resolveFeedbackStoreForOrder(req.scope, {
    orderId: feedback.order_id,
    salesChannelId: order?.sales_channel_id ?? null,
  });

  // No artwork once answered — the page only shows the thank-you state.
  const artworks = isFeedbackAnswered(feedback)
    ? []
    : selectArtworkChoices(
        await fetchArtworkPool(req, resolveArtworkSourceId(process.env)),
        id,
        ARTWORK_COUNT
      );

  res.status(200).json({
    ...buildPublicFeedbackView({
      feedback,
      order,
      store: { name: store.store_name, url: store.origin },
    }),
    artworks,
  });
};

/**
 * Record the buyer's answer: a required 1..5 rating, an optional comment and an
 * optional artwork pick. The chosen artwork is validated against the SAME
 * seeded set the GET returns, so an arbitrary id can't be recorded; a rejected
 * pick does not lose the rating.
 *
 * One answer per request: once `answered_at` is set a second POST is a 409, so
 * a forwarded link can't overwrite what the buyer said.
 *
 * POST /web/feedback/:id  { rating, comment?, artwork_id?, affinity? }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const body = (req.body || {}) as Record<string, any>;
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const { service, feedback } = await loadBuyerFeedback(req, id);

  if (isFeedbackAnswered(feedback)) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "This feedback has already been answered. Thank you!"
    );
  }

  const parsed = parseFeedbackSubmission(body);
  if (!parsed.ok) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.reason);
  }

  const update: Record<string, any> = {
    id,
    rating: parsed.rating,
    comment: parsed.comment,
    answered_at: new Date(),
  };

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

  await service.updateFeedbacks(update);
  // Read the row back: the response reports what persisted, not what we sent.
  const refreshed: any = (await service.listFeedbacks({ id }))?.[0] ?? null;
  const view = refreshed ? buildPublicFeedbackView({ feedback: refreshed }) : null;

  res.status(200).json({
    feedback: view?.feedback ?? null,
    artwork_pick_rejected: pickRejected,
  });
};
