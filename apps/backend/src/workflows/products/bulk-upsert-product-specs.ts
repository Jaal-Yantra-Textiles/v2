import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PRODUCT_SPEC_MODULE } from "../../modules/product-spec"
import {
  upsertProductSpecWorkflow,
  type ProductSpecInput,
} from "./upsert-product-spec"

/**
 * Write a production spec across MANY products in one call (#1342 follow-up).
 *
 * The single-product route (`POST /partners/products/:id/spec`) is the right
 * shape for a partner editing one piece by hand, and the wrong shape for the
 * thing partners actually do: they weave a run of twenty shawls that share a
 * weave, a param set and a palette, and differ only in colourway. Setting that
 * one product at a time is twenty confirmations for one decision.
 *
 * Deliberately mirrors `bulk-update-products.ts` rather than inventing a second
 * batch idiom:
 *
 *  - **Per-row outcomes.** One bad product id never discards the rest of the
 *    batch. Callers read `results[]`, not the status code.
 *  - **`dry_run` returns the plan without writing**, and the plan names every
 *    product it would touch and whether that would CREATE or UPDATE a spec.
 *    A partner about to overwrite fifteen existing specs should see the word
 *    "update" fifteen times before it happens, not after.
 *  - **Scoping is the caller's to supply.** The partner route passes the ids it
 *    has already ownership-checked; the admin route passes none. A batch route
 *    that decides its own scope is one refactor away from a partner writing
 *    someone else's catalogue.
 *
 * ## Upsert, and why there is no separate "create"
 *
 * `upsertProductSpecWorkflow` already creates when absent and updates when
 * present, and the caller almost never knows which state a given product is in
 * — that is the whole reason for reaching for a batch. Two tools would force
 * the caller to find out first, and would fail half a batch that happened to be
 * mixed. So: one entry point, and the per-row outcome reports which one
 * actually happened (`created` | `updated`), which is the information the
 * caller wanted from the distinction in the first place.
 *
 * ⚠️ `colors`, `fields` and `options` REPLACE what is stored when present — the
 * same semantics as the single route. Omit a key to leave those rows alone.
 * Applied across a batch this is the sharpest edge here, which is why the
 * dry-run plan reports, per product, exactly which of the three would be
 * replaced.
 */

/** Cap per call. Above this, the caller should page. */
export const BULK_SPEC_MAX_PRODUCTS = 100

export type BulkProductSpecItem = {
  product_id: string
  /** Per-row spec. Wins over `spec` when both are given. */
  spec?: ProductSpecInput
}

export type BulkUpsertProductSpecsInput = {
  /** Products to write. */
  products: BulkProductSpecItem[]
  /** Applied to every row that has no `spec` of its own. */
  spec?: ProductSpecInput
  dry_run?: boolean
}

export type BulkSpecScope = {
  /**
   * When present, any product id outside this set becomes an error row rather
   * than a write. `undefined` means unscoped (admin).
   */
  allowedProductIds?: Set<string>
}

export type BulkSpecRowResult = {
  product_id: string
  ok: boolean
  /** What happened, or what would happen under dry_run. */
  action: "created" | "updated" | "skipped" | "error"
  /** Which replace-wholesale keys this row carries. */
  replaces?: string[]
  error?: string
}

export type BulkUpsertProductSpecsResult = {
  dry_run: boolean
  requested: number
  ok_count: number
  error_count: number
  results: BulkSpecRowResult[]
  warnings: string[]
}

/** The keys whose presence replaces stored rows wholesale. */
const REPLACE_KEYS = ["colors", "fields", "options"] as const

export const bulkUpsertProductSpecs = async (
  container: any,
  input: BulkUpsertProductSpecsInput,
  scope: BulkSpecScope = {}
): Promise<BulkUpsertProductSpecsResult> => {
  const dryRun = input.dry_run === true
  const warnings: string[] = []

  const rows = Array.isArray(input.products) ? input.products : []

  if (rows.length > BULK_SPEC_MAX_PRODUCTS) {
    warnings.push(
      `Received ${rows.length} products; only the first ${BULK_SPEC_MAX_PRODUCTS} were processed. Send the rest in another call.`
    )
  }
  const capped = rows.slice(0, BULK_SPEC_MAX_PRODUCTS)

  // Deduplicate, keeping the LAST occurrence. Two rows for one product would
  // otherwise write twice, and — because colors/fields/options replace — the
  // second silently discards the first. Reporting it beats resolving it
  // quietly.
  const seen = new Map<string, BulkProductSpecItem>()
  for (const row of capped) {
    const id = String(row?.product_id ?? "").trim()
    if (!id) continue
    if (seen.has(id)) {
      warnings.push(
        `Product ${id} appeared more than once; only the last entry was applied.`
      )
    }
    seen.set(id, row)
  }

  const service: any = container.resolve(PRODUCT_SPEC_MODULE)
  const results: BulkSpecRowResult[] = []

  for (const [productId, row] of seen) {
    const spec = row.spec ?? input.spec

    if (!spec || typeof spec !== "object") {
      results.push({
        product_id: productId,
        ok: false,
        action: "error",
        error:
          "No spec for this row. Provide `spec` on the row, or a batch-wide `spec`.",
      })
      continue
    }

    if (scope.allowedProductIds && !scope.allowedProductIds.has(productId)) {
      // Same wording the single route's ownership check produces, so a partner
      // cannot tell "not yours" from "does not exist".
      results.push({
        product_id: productId,
        ok: false,
        action: "error",
        error: `Product ${productId} not found`,
      })
      continue
    }

    const replaces = REPLACE_KEYS.filter(
      (k) => (spec as Record<string, unknown>)[k] !== undefined
    )

    let existing: unknown = null
    try {
      existing = await service.findByProduct(productId)
    } catch {
      // A read failure here only costs us the created/updated label; the write
      // below is still the source of truth. Don't fail the row for it.
      existing = null
    }
    const action = existing ? "updated" : "created"

    if (dryRun) {
      results.push({
        product_id: productId,
        ok: true,
        action,
        ...(replaces.length ? { replaces } : {}),
      })
      continue
    }

    try {
      await upsertProductSpecWorkflow(container).run({
        input: { product_id: productId, data: spec as any },
      })
      results.push({
        product_id: productId,
        ok: true,
        action,
        ...(replaces.length ? { replaces } : {}),
      })
    } catch (e: any) {
      results.push({
        product_id: productId,
        ok: false,
        action: "error",
        error: e?.message ? String(e.message) : "Failed to write spec",
      })
    }
  }

  const okCount = results.filter((r) => r.ok).length

  return {
    dry_run: dryRun,
    requested: seen.size,
    ok_count: okCount,
    error_count: results.length - okCount,
    results,
    warnings,
  }
}
