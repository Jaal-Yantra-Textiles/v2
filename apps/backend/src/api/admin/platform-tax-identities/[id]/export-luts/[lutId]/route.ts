import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { PLATFORM_TAX_IDENTITY_MODULE } from "../../../../../../modules/platform-tax-identity"

/**
 * One export LUT (#1216).
 *
 * POST   — correct a recorded LUT (a typo'd ARN, a wrong date) or withdraw it via
 *          `is_active: false`.
 * DELETE — soft-delete, for a row created in error.
 *
 * Withdrawing is the normal way to stop relying on an LUT: it keeps the row
 * readable for shipments already declared under it, while
 * `resolveExportIgstStatus` immediately falls back to "C".
 */

async function loadLut(req: MedusaRequest) {
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "platform_export_lut",
    fields: ["id", "tax_identity_id"],
    filters: { id: req.params.lutId },
  })
  const lut = data?.[0]
  // Scope the child to its parent — an id from another identity must 404 here
  // rather than be editable through the wrong path.
  if (!lut || lut.tax_identity_id !== req.params.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Export LUT ${req.params.lutId} not found on tax identity ${req.params.id}`
    )
  }
  return lut
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await loadLut(req)

  const body = req.validatedBody as {
    arn?: string
    financial_year?: string
    valid_from?: string
    valid_to?: string
    filed_on?: string | null
    notes?: string | null
    is_active?: boolean
  }

  const update: Record<string, any> = { id: req.params.lutId }
  if (body.arn !== undefined) update.arn = body.arn.trim()
  if (body.financial_year !== undefined)
    update.financial_year = body.financial_year.trim()
  if (body.valid_from !== undefined) update.valid_from = new Date(body.valid_from)
  if (body.valid_to !== undefined) update.valid_to = new Date(body.valid_to)
  if (body.filed_on !== undefined)
    update.filed_on = body.filed_on ? new Date(body.filed_on) : null
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null
  if (body.is_active !== undefined) update.is_active = body.is_active

  const service: any = req.scope.resolve(PLATFORM_TAX_IDENTITY_MODULE)
  const [lut] = await service.updatePlatformExportLuts([update])

  res.json({ export_lut: lut })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await loadLut(req)

  const service: any = req.scope.resolve(PLATFORM_TAX_IDENTITY_MODULE)
  await service.deletePlatformExportLuts([req.params.lutId])

  res.json({ id: req.params.lutId, object: "export_lut", deleted: true })
}
