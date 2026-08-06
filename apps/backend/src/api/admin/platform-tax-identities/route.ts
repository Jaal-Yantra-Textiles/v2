import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /admin/platform-tax-identities
 *
 * List the platform's tax identities with the export LUTs furnished under each
 * (#1216). Until now this table had NO admin surface at all — it was seed-managed
 * — so the LUT UI needs a way to see which registration it is attaching to.
 *
 * Read-only on purpose: a GSTIN/VAT number appearing on shipping labels is not
 * something to make casually editable, and #1216 only needs to add LUTs to the
 * identities that already exist.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "platform_tax_identity",
    fields: [
      "id",
      "brand_code",
      "legal_name",
      "tax_id",
      "tax_id_type",
      "country_codes",
      "is_active",
      // Dotted paths — a star on a relation is silently dropped.
      "export_luts.id",
      "export_luts.arn",
      "export_luts.financial_year",
      "export_luts.valid_from",
      "export_luts.valid_to",
      "export_luts.filed_on",
      "export_luts.notes",
      "export_luts.is_active",
    ],
  })

  res.json({ platform_tax_identities: data ?? [] })
}
