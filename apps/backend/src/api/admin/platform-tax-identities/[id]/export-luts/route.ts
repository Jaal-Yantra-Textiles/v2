import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { PLATFORM_TAX_IDENTITY_MODULE } from "../../../../../modules/platform-tax-identity"

/**
 * Export LUTs for one platform tax identity (#1216).
 *
 * GET  — list them, newest cover first.
 * POST — record a newly furnished LUT (form RFD-11).
 *
 * Recording is an INSERT per financial year, never an update of last year's row:
 * an LUT that past shipments were declared under has to stay readable, and
 * renewal is a new instrument, not an edited one.
 */

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "platform_export_lut",
    fields: [
      "id",
      "arn",
      "financial_year",
      "valid_from",
      "valid_to",
      "filed_on",
      "notes",
      "is_active",
      "created_at",
    ],
    filters: { tax_identity_id: req.params.id },
  })

  const luts = (data ?? []).sort(
    (a: any, b: any) =>
      new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime()
  )

  res.json({ export_luts: luts })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as {
    arn: string
    financial_year: string
    valid_from: string
    valid_to: string
    filed_on?: string
    notes?: string
    is_active?: boolean
  }

  const service: any = req.scope.resolve(PLATFORM_TAX_IDENTITY_MODULE)
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // The identity must exist — an LUT hanging off a non-existent registration
  // would resolve to nothing and look like "no LUT filed" forever.
  const { data: identities } = await query.graph({
    entity: "platform_tax_identity",
    fields: ["id", "tax_id_type"],
    filters: { id: req.params.id },
  })
  const identity = identities?.[0]
  if (!identity) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Platform tax identity ${req.params.id} not found`
    )
  }

  const [lut] = await service.createPlatformExportLuts([
    {
      arn: body.arn.trim(),
      financial_year: body.financial_year.trim(),
      valid_from: new Date(body.valid_from),
      valid_to: new Date(body.valid_to),
      filed_on: body.filed_on ? new Date(body.filed_on) : null,
      notes: body.notes?.trim() || null,
      is_active: body.is_active ?? true,
      tax_identity_id: req.params.id,
    },
  ])

  res.status(201).json({ export_lut: lut })
}
