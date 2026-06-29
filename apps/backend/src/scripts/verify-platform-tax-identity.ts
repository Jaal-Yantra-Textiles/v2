import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PLATFORM_TAX_IDENTITY_MODULE } from "../modules/platform-tax-identity"
import {
  resolvePlatformTaxIdString,
  type PlatformTaxIdentityRow,
} from "../modules/platform-tax-identity/resolve-lib"

/**
 * READ-ONLY prod verification for #348 (slice B).
 *
 * Confirms two things that can only be checked against the live DB:
 *   1. The `platform_tax_identity` table migrated AND seeded
 *      (Migration20260622140000) — the recurring "first-deploy migration
 *      miss" gotcha means we can't assume it ran.
 *   2. The pure country→fallback resolver returns the expected brand IDs
 *      (IN → JYT GSTIN, an EU country → KHT EU-VAT).
 *
 * Writes nothing. Exits 0 on PASS; throws (non-zero) on FAIL so the Fargate
 * task surfaces a failed status.
 *
 * Usage (prod):
 *   FOLLOW=1 ./deploy/aws/scripts/run-backfill.sh verify-platform-tax-identity
 */
const EXPECTED: Array<{ country: string; brand: string; taxId: string }> = [
  { country: "IN", brand: "JYT", taxId: "07AAGCJ0494A1ZV" },
  { country: "DE", brand: "KHT", taxId: "40203579735" },
]

export default async function verifyPlatformTaxIdentity({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(PLATFORM_TAX_IDENTITY_MODULE)

  let rows: PlatformTaxIdentityRow[] = []
  try {
    rows = await service.listPlatformTaxIdentities({}, { take: 100 })
  } catch (e: any) {
    logger.error(
      `[348-verify] FAILED to list platform_tax_identity — table missing or module unresolved? ${e?.message ?? e}`
    )
    throw e
  }

  logger.info(`[348-verify] platform_tax_identity rows found: ${rows.length}`)
  for (const r of rows) {
    logger.info(
      `[348-verify]   • ${r.brand_code} ${r.tax_id_type}=${r.tax_id} active=${r.is_active} countries=${(r.country_codes ?? []).join("/")}`
    )
  }

  let allOk = rows.length > 0
  if (!allOk) {
    logger.error(
      "[348-verify] table is EMPTY — migration likely did not seed; re-migrate before relying on the fallback."
    )
  }

  for (const exp of EXPECTED) {
    const resolved = resolvePlatformTaxIdString(exp.country, rows)
    const ok = resolved === exp.taxId
    allOk = allOk && ok
    logger.info(
      `[348-verify] ${exp.country} → ${exp.brand}: resolved=${resolved ?? "(none)"} expected=${exp.taxId} ${ok ? "PASS" : "FAIL"}`
    )
  }

  if (allOk) {
    logger.info(
      "[348-verify] ✅ PASS — table seeded and resolver returns the expected fallbacks. #348 is prod-confirmed."
    )
    return
  }

  throw new Error(
    "[348-verify] ❌ FAIL — table empty or resolver mismatch (see lines above). #348 NOT confirmed."
  )
}
