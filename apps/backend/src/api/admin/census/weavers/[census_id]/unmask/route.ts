import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { CENSUS_MODULE } from "../../../../../../modules/census"
import type CensusModuleService from "../../../../../../modules/census/service"
import { isMfaEnabled } from "../../../../social-platforms/secrets"

/**
 * GET /admin/census/weavers/:census_id/unmask
 *
 * Reveal a single weaver's FULL (unredacted) PII from the encrypted sensitive
 * core. Two independent gates, both fail closed:
 *
 *   1. MFA — the caller's auth identity must have an ENABLED Medusa MFA factor
 *      (same gate as social-platform secret reveal, isMfaEnabled).
 *   2. CENSUS_UNMASK_TOKEN — the reader node only decrypts when Medusa presents
 *      the shared bearer (the encryption key itself never leaves the node).
 *
 * Every successful reveal writes a `census_unmask_audit` row (best-effort: a
 * logging failure never blocks the reveal). The FULL PII is deliberately
 * per-record and on-demand — never bulk, never in the list response.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const censusId = req.params.census_id

  if (!(await isMfaEnabled(req))) {
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "MFA is required to reveal a weaver's full PII"
    )
  }

  const census = req.scope.resolve(CENSUS_MODULE) as CensusModuleService
  const weaver = await census.unmaskWeaver(censusId)

  if (!weaver) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `no census weaver with id ${censusId}`
    )
  }

  // Durable audit — best-effort, never fails the reveal.
  const actorId = (req as any).auth_context?.actor_id ?? "unknown"
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    await census.createCensusUnmaskAudits({
      census_id: String(censusId),
      actor_id: actorId,
      fields: { keys: Object.keys(weaver) },
    })
  } catch (e: any) {
    logger.error(`[census/unmask] audit persist failed: ${e?.message ?? e}`)
  }

  res.status(200).json({ weaver })
}