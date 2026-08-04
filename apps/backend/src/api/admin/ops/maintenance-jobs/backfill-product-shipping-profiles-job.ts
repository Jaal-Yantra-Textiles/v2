import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #1195 item 4 — give profile-less products a shipping profile.
 *
 * This is the ROOT repair the other #1195 work routes around. A product with no
 * shipping profile poisons three separate things:
 *
 *  1. `prepareLineItemData` derives `requires_shipping: false` for it (there is
 *     no profile and our variants are `manage_inventory: false`), which is what
 *     hides "Mark as shipped" in the dashboard;
 *  2. `create-fulfillment.js:78-83` refuses to fulfil a requires-shipping item
 *     whose product profile doesn't match the chosen option — so the flag
 *     CANNOT simply be flipped on a profile-less product;
 *  3. `validateShippingStep` blocks cart completion for the same mismatch.
 *
 * Once a product carries a profile, the derivation yields `true` on its own and
 * every downstream check lines up. Prod measured 54 of 75 products with no
 * profile.
 *
 * Links product → shipping profile through the same remote link
 * `createProductsWorkflow` writes:
 *   { [Modules.PRODUCT]: { product_id }, [Modules.FULFILLMENT]: { shipping_profile_id } }
 *
 * Idempotent: a product that already has a profile is never re-linked or
 * moved — this only ever fills a gap, it does not reassign.
 */

/** Hard cap on products scanned in one call. */
export const MAX_PRODUCT_PROFILE_SCAN = 5000

const paramsSchema = z.object({
  /** Restrict to a single product. */
  product_id: z.string().min(1).optional(),
  /**
   * Profile to link. Defaults to the store's `type: "default"` profile, which
   * is the one `createProductsWorkflow` assigns when the admin UI creates a
   * product normally.
   */
  profile_id: z.string().min(1).optional(),
  /** Max products to scan in one call. */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_PRODUCT_PROFILE_SCAN)
    .optional()
    .default(1000),
})

/**
 * PURE: does this product need a profile link? Only when it has none —
 * an existing profile is never reassigned. Exported for unit testing.
 */
export function needsShippingProfile(product: any): boolean {
  return !!product?.id && !product?.shipping_profile?.id
}

/**
 * PURE: pick the profile to link. An explicit id wins; otherwise the
 * `type: "default"` profile; otherwise — when exactly one profile exists — that
 * one. Returns null when the choice is ambiguous, so the job fails loudly
 * rather than scattering products across profiles. Exported for unit testing.
 */
export function pickTargetProfileId(
  profiles: any[],
  explicitId?: string
): string | null {
  if (explicitId) {
    return profiles.some((p) => p?.id === explicitId) ? explicitId : null
  }
  const defaults = profiles.filter((p) => p?.type === "default")
  if (defaults.length === 1) return defaults[0].id
  if (defaults.length === 0 && profiles.length === 1) return profiles[0].id
  return null
}

/** PURE: the operator-facing summary line. Exported for unit testing. */
export function summarizeProfileBackfill(
  dryRun: boolean,
  scanned: number,
  linked: number,
  profileId: string
): string {
  if (linked === 0) {
    return `No changes — scanned ${scanned} product(s), all already carry a shipping profile`
  }
  return `${dryRun ? "Would link" : "Linked"} ${linked} of ${scanned} scanned product(s) to shipping profile ${profileId}`
}

export const backfillProductShippingProfilesJob: MaintenanceJob = {
  id: "backfill-product-shipping-profiles",
  label: "Backfill product shipping profiles (#1195)",
  description:
    "Link every product that has NO shipping profile to the store's default one (or an explicit profile_id). A profile-less product derives requires_shipping=false — which hides 'Mark as shipped' — and cannot be fulfilled or checked out once that flag is true, because both create-fulfillment and validateShippingStep compare the product's profile against the chosen shipping option's. Products that already have a profile are never reassigned. Dry-run previews the links; apply is idempotent.",
  params: [
    {
      name: "product_id",
      type: "string",
      required: false,
      description: "Restrict the run to a single product id",
    },
    {
      name: "profile_id",
      type: "string",
      required: false,
      description:
        "Shipping profile to link (defaults to the store's type:\"default\" profile)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max products to scan in one call (default 1000, max ${MAX_PRODUCT_PROFILE_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { product_id, profile_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    const { data: profiles } = await query.graph({
      entity: "shipping_profile",
      fields: ["id", "name", "type"],
      pagination: { take: 100 },
    })

    const targetProfileId = pickTargetProfileId(profiles || [], profile_id)
    if (!targetProfileId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        profile_id
          ? `Shipping profile ${profile_id} not found`
          : `Could not pick a default shipping profile (${(profiles || []).length} found) — pass profile_id explicitly`
      )
    }

    const filters: Record<string, unknown> = {}
    if (product_id) {
      filters.id = product_id
    }

    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title", "shipping_profile.id"],
      filters,
      pagination: { take: limit },
    })

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    for (const product of (products || []) as any[]) {
      if (!needsShippingProfile(product)) continue

      changes.push({
        entity: "product",
        id: product.id,
        field: `shipping_profile (${product.title ?? product.id})`,
        before: null,
        after: targetProfileId,
      })

      if (!dry_run) {
        try {
          // Same link shape `createProductsWorkflow` writes — operand order
          // matters, a reversed pair links nothing and reports success.
          await remoteLink.create({
            [Modules.PRODUCT]: { product_id: product.id },
            [Modules.FULFILLMENT]: { shipping_profile_id: targetProfileId },
          })
        } catch (e: any) {
          errors.push({ id: product.id, message: e?.message ?? String(e) })
        }
      }
    }

    return {
      job_id: backfillProductShippingProfilesJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0 && errors.length < changes.length,
      summary: summarizeProfileBackfill(
        dry_run,
        (products || []).length,
        changes.length,
        targetProfileId
      ),
      changes,
      errors: errors.length ? errors : undefined,
    }
  },
}
