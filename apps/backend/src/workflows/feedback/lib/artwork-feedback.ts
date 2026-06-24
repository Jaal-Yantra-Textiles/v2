// Pure, side-effect-free helpers for the playful artwork-rating mechanic in the
// post-delivery feedback flow (#452). Kept free of Medusa/container deps so the
// artwork selection, pick validation and update-payload assembly are
// unit-testable without booting Medusa or the media module.
//
// The customer opens the SAME feedback page+token they already get on delivery
// (`/feedback/:id`). Instead of a boring "rate us", we present a small set of
// artwork images and let them pick the one they identify with. The pick is
// additive and optional — the 1..5 rating keeps working on its own.

export type RatingEnum = "one" | "two" | "three" | "four" | "five";

const RATING_BY_NUMBER: Record<number, RatingEnum> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
};

const RATING_SET: ReadonlySet<string> = new Set([
  "one",
  "two",
  "three",
  "four",
  "five",
]);

/**
 * Normalise a rating supplied by the storefront. Accepts the enum string
 * ("one".."five"), the numeric form (1..5, as number or numeric string), and
 * returns `undefined` for anything out of range (so the rating is simply left
 * untouched rather than throwing — the artwork pick can stand on its own).
 */
export function normalizeRatingValue(
  input: unknown
): RatingEnum | undefined {
  if (typeof input === "string") {
    const trimmed = input.trim().toLowerCase();
    if (RATING_SET.has(trimmed)) {
      return trimmed as RatingEnum;
    }
    if (/^[1-5]$/.test(trimmed)) {
      return RATING_BY_NUMBER[Number(trimmed)];
    }
    return undefined;
  }
  if (typeof input === "number" && Number.isInteger(input)) {
    return RATING_BY_NUMBER[input];
  }
  return undefined;
}

/**
 * Resolve the OPTIONAL curated media source (an Album or media Folder id) the
 * artwork pool is scoped to. When `FEEDBACK_ARTWORK_ALBUM_ID` (or an explicit
 * override) is set, the pool is scoped to that album/folder; when unset, this
 * returns `null` — meaning "draw from the GENERAL public media pool via the
 * media randomiser" (the same mechanism as `GET /web/media`). No curated album
 * is required, so the feature works against whatever media a fresh admin has.
 * Precedence: explicit override → FEEDBACK_ARTWORK_ALBUM_ID → null (general pool).
 */
export function resolveArtworkSourceId(
  env: Record<string, string | undefined> = {},
  override?: string | null
): string | null {
  const raw = (override || env.FEEDBACK_ARTWORK_ALBUM_ID || "").trim();
  return raw || null;
}

export interface MediaLike {
  id: string;
  original_name?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  file_type?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  title?: string | null;
  description?: string | null;
  alt_text?: string | null;
  caption?: string | null;
}

export interface ArtworkChoice {
  id: string;
  file_path: string | null;
  type: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  title: string | null;
  alt_text: string | null;
  caption: string | null;
}

/**
 * Map a media_file row to the lean, public-safe artwork shape returned to the
 * storefront. Mirrors the sanitised subset exposed by `GET /web/media` so the
 * frontend can build the image URL the same way (NEXT_PUBLIC_AWS_S3 + file_path).
 */
export function mapMediaToArtworkChoice(media: MediaLike): ArtworkChoice {
  return {
    id: media.id,
    file_path: media.file_path ?? null,
    type: media.file_type ?? null,
    mime_type: media.mime_type ?? null,
    width: media.width ?? null,
    height: media.height ?? null,
    title: media.title ?? null,
    alt_text: media.alt_text ?? null,
    caption: media.caption ?? null,
  };
}

// --- Seeded RNG (FNV-1a → mulberry32), identical algorithm to GET /web/media so
// the selection behaves consistently across the codebase and is fully
// deterministic given a seed. ---

function seedToInt(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], seed: string): T[] {
  const out = [...arr];
  const rand = mulberry32(seedToInt(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick `count` distinct artworks from `pool`, deterministically varied by
 * `seed`. The same seed always yields the same set (so the offered set can be
 * reproduced on the submit request to validate the pick), while different
 * seeds — e.g. a different feedback id / order — yield a different set, which
 * is the per-token variation the issue asks for.
 *
 * De-dupes by id, drops empty ids, and never returns more than the pool holds.
 */
export function selectArtworkChoices(
  pool: ArtworkChoice[] | null | undefined,
  seed: string,
  count = 3
): ArtworkChoice[] {
  if (!Array.isArray(pool) || pool.length === 0 || count <= 0) {
    return [];
  }

  // De-dupe by id, keeping a stable first-seen order so the shuffle is the only
  // source of variation (pool order from the DB must not leak in).
  const seen = new Set<string>();
  const unique: ArtworkChoice[] = [];
  for (const item of pool) {
    if (!item || !item.id || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  unique.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return seededShuffle(unique, seed || "").slice(0, Math.min(count, unique.length));
}

export interface ArtworkPickInput {
  feedbackId: string;
  artworkId: string;
  /** Optional affinity label the customer (or the UI) attaches to the pick. */
  affinity?: string | null;
  /** Ids that were actually offered for this feedback (the GET response). */
  offeredIds: string[];
  /** Existing feedback.metadata so the audit breadcrumb is merged, not lost. */
  existingMetadata?: Record<string, any> | null;
  now?: Date;
}

export interface ArtworkPickUpdate {
  id: string;
  chosen_artwork_id: string;
  artwork_affinity: string | null;
  metadata: Record<string, any>;
}

/**
 * Build the feedback-update payload that records an artwork pick. Returns
 * `null` (caller treats as a no-op / 400) when the chosen artwork was not among
 * those offered — so a client can't record an arbitrary id. The load-bearing
 * state goes into typed columns; metadata only carries a non-critical audit
 * breadcrumb (chosen_at) merged onto whatever was already there.
 */
export function buildArtworkPickUpdate(
  input: ArtworkPickInput
): ArtworkPickUpdate | null {
  const { feedbackId, artworkId, offeredIds } = input;
  if (!feedbackId || !artworkId) {
    return null;
  }
  if (!Array.isArray(offeredIds) || !offeredIds.includes(artworkId)) {
    return null;
  }

  const now = input.now ?? new Date();
  const affinity =
    typeof input.affinity === "string" && input.affinity.trim().length
      ? input.affinity.trim()
      : null;

  return {
    id: feedbackId,
    chosen_artwork_id: artworkId,
    artwork_affinity: affinity,
    metadata: {
      ...(input.existingMetadata ?? {}),
      artwork_pick: {
        artwork_id: artworkId,
        affinity,
        chosen_at: now.toISOString(),
      },
    },
  };
}
