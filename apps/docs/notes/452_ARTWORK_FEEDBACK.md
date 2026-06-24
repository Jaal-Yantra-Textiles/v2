# #452 — Playful artwork-rating in the post-delivery feedback flow

Instead of a boring "rate us", the post-delivery feedback page presents the
customer a small set of **artwork images** and lets them pick the one they
**identify with** — art-led and playful. The pick is recorded alongside the
order/feedback. This is **additive**: the existing trigger, email link and 1..5
rating are untouched; the artwork pick is optional.

## What already existed (NOT rebuilt)

- `delivery.created` → subscriber `src/subscribers/order-delivered-feedback.ts`
  → workflow `src/workflows/feedback/request-post-delivery-feedback.ts` creates
  an idempotent pending feedback row (keyed on the typed `order_id` column) and
  emails the customer a link to `${STORE_URL}/feedback/:id` (template
  `order-feedback-request`). The **feedback id IS the page token**.

## What this change adds (backend)

1. **Typed columns** on `feedback` (`src/modules/feedback/models/feedback.ts`):
   - `chosen_artwork_id` (text, nullable) — the picked artwork's `media_file` id.
   - `artwork_affinity` (text, nullable) — optional affinity label.
   Load-bearing analytical state ⇒ typed columns, **not** the metadata blob
   (metadata is fully replaced on update). Migration
   `Migration20260624150000.ts` (hand-written `add column if not exists` ALTER —
   never edit the create-table migration).

2. **Pure helpers** `src/workflows/feedback/lib/artwork-feedback.ts` (17 unit
   tests):
   - `resolveArtworkSourceId(env, override?)` — curated source (Album/Folder id),
     `FEEDBACK_ARTWORK_ALBUM_ID` env → default `media_art_hero`.
   - `selectArtworkChoices(pool, seed, count=3)` — deterministic seeded selection
     (FNV-1a → mulberry32, same algo as `GET /web/media`). Same seed → same set
     (so the offered set is reproducible to validate a pick); different seed
     (different feedback id) → different set = the per-token variation the issue
     asks for. De-dupes by id, sorts before shuffle so DB order never leaks.
   - `buildArtworkPickUpdate(...)` — validates the pick is among the offered ids,
     builds the typed-column update + a non-critical `metadata.artwork_pick`
     audit breadcrumb (merged, not replacing). Returns `null` (→ 400) on an
     un-offered/empty id.
   - `normalizeRatingValue(...)` — accepts `"one".."five"` or `1..5`.

3. **Public page API** `src/api/web/feedback/[id]/route.ts` (CORS inherited from
   the global `/web/*` matcher; no auth — the id is the capability token):
   - `GET /web/feedback/:id` → `{ feedback, artworks }`. Artworks are the seeded
     3-set drawn from the curated public-image pool (Album first, media Folder
     fallback — mirrors `GET /web/media`). No pool configured ⇒ `artworks: []`
     and the page degrades to a plain rating.
   - `POST /web/feedback/:id` `{ rating?, comment?, artwork_id?, affinity? }` →
     records rating/comment and the **validated** artwork pick into the typed
     columns. Pick validated against the same seeded set the GET returns. 400 if
     nothing valid (or the artwork wasn't offered).

## Artwork source

Reuses the **media module** — a curated Album or media Folder of public images,
exactly the mechanism the storefront hero already uses (folder `media_art_hero`,
roadmap #22). Admin-editable via env `FEEDBACK_ARTWORK_ALBUM_ID`; no new model.
To curate: drop artwork into that folder/album (public images).

## Storefront page (follow-up — NOT in this PR)

The customer page lives in the `storefront-starter` **submodule** and does not
exist yet (the email currently links to a route the storefront must add). This
PR ships the backend contract + logic so the page is pure presentation. The page
should:
1. `GET /web/feedback/:id` → render the 1..5 rating + the 3 artwork tiles
   (image URL = `NEXT_PUBLIC_AWS_S3 + file_path`, same as the media gallery).
2. On submit `POST /web/feedback/:id` with the chosen `artwork_id` (+ rating).
Building it is Playwright-gated UI in a separate repo → deferred.

## Manual verification (curl)

```bash
# Seed: put public images in a folder, set FEEDBACK_ARTWORK_ALBUM_ID=<folderId>.
# Pick a pending feedback id (e.g. from a delivered test order).
curl -s "$BACKEND/web/feedback/<id>" | jq '.artworks | length'   # → 3
curl -s -X POST "$BACKEND/web/feedback/<id>" \
  -H 'content-type: application/json' \
  -d '{"rating":5,"artwork_id":"<one-of-the-returned-ids>","affinity":"calm"}' | jq
# → feedback.chosen_artwork_id == artwork_id, rating == "five"
```

Automated coverage: `artwork-feedback.unit.spec.ts` (17) +
`integration-tests/http/artwork-feedback.spec.ts` (3, full GET/POST + persistence).
