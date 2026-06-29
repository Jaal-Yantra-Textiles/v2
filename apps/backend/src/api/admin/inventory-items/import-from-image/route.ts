/**
 * @file Inventory "Import From Image" route (#770)
 * @description Canonical, inventory-nested entry point for the AI image-import
 * tool. Bulk-style (no `[id]`): extract a list of raw materials / inventory
 * items from a single image, optionally persisting them.
 *
 * POST /admin/inventory-items/import-from-image
 *
 * The handler is shared with the legacy `/admin/ai/image-extraction` route,
 * which is retained as a backward-compatible alias (and keeps its place in the
 * AI OpenAPI group). New callers — the admin "Import From Image" page and its
 * `useImageExtraction` hook — target this inventory-nested path.
 *
 * Validation is wired in `src/api/middlewares.ts` for this matcher, mirroring
 * the legacy route (`validateAndTransformBody(wrapSchema(AdminImageExtractionReq))`).
 */
export { POST } from "../../ai/image-extraction/route"
