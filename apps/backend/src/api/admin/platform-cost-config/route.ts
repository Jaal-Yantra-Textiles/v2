import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PLATFORM_COST_CONFIG_MODULE } from "../../../modules/platform-cost-config"
import {
  readCostConfig,
  resolveCostConfig,
} from "../../../modules/platform-cost-config/resolve-lib"
import { buildNextConfig } from "./carry-forward"

/**
 * GET /admin/platform-cost-config
 *
 * The platform's economic policy (#1939): the five numbers that decide what a
 * design costs and what a buyer pays.
 *
 * Returns BOTH the policy in force and the full history, because they answer
 * different questions — "what are we charging?" and "what were we charging in
 * March?" — and a surface that only answered the first would make the second
 * require database access.
 *
 * `?at=<ISO date>` resolves the policy in force at that moment instead of now,
 * which is how a past price is explained.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PLATFORM_COST_CONFIG_MODULE)

  const atRaw = (req.query?.at as string) || null
  const at = atRaw ? new Date(atRaw) : new Date()
  if (Number.isNaN(at.getTime())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `\`at\` is not a valid date: ${atRaw}`
    )
  }

  const rows = await service.listPlatformCostConfigs({}, { take: null })
  const inForce = resolveCostConfig(rows, at)

  res.json({
    /**
     * The resolved numbers. Every one may be null — null means NOT CONFIGURED,
     * never zero. A consumer must fall back to its own documented constant.
     */
    cost_config: readCostConfig(inForce),
    /** Which row that came from, so a price can cite its policy. */
    in_force_id: inForce?.id ?? null,
    resolved_at: at.toISOString(),
    /** Newest first — the audit trail, superseded rows included. */
    history: [...(rows ?? [])].sort(
      (a: any, b: any) =>
        new Date(b.effective_from).getTime() -
        new Date(a.effective_from).getTime()
    ),
  })
}

/**
 * POST /admin/platform-cost-config
 *
 * Set the next economic policy. This is an INSERT, never an update: the table is
 * effective-dated so a price already quoted stays explicable under the policy it
 * was quoted under.
 *
 * 🔴 OMITTED fields carry forward from the policy currently in force; an
 * explicit `null` unsets one. See `buildNextConfig` — without that rule, sending
 * a single field would blank the other four and silently switch off the
 * platform's economics.
 *
 * ⚠️ This changes what customers pay. It is marked sensitive on the MCP surface.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PLATFORM_COST_CONFIG_MODULE)
  const body = (req.validatedBody ?? {}) as Record<string, unknown>

  const effectiveFrom = body.effective_from
    ? new Date(String(body.effective_from))
    : new Date()
  if (Number.isNaN(effectiveFrom.getTime())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `\`effective_from\` is not a valid date: ${body.effective_from}`
    )
  }

  const rows = await service.listPlatformCostConfigs({}, { take: null })
  // Carry forward from the policy in force AT THE NEW ROW'S OWN DATE — not
  // simply the latest row. Back-dating a correction must inherit from what was
  // actually in force then, otherwise it would import a later policy's numbers
  // into an earlier period.
  const current = resolveCostConfig(rows, effectiveFrom)

  const created = await service.createPlatformCostConfigs({
    effective_from: effectiveFrom,
    notes: Object.prototype.hasOwnProperty.call(body, "notes")
      ? body.notes
      : null,
    is_active: true,
    ...buildNextConfig(body, current),
  })

  const row = Array.isArray(created) ? created[0] : created
  res.status(201).json({ cost_config: row })
}
