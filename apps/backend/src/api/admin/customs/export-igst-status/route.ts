import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { resolveExportIgstForCountry } from "../../../../modules/shipping-providers/export-igst"

/**
 * GET /admin/customs/export-igst-status
 *
 * What an export label would declare for IGST RIGHT NOW, and why (#1216).
 *
 * This is the read the UI banner and the expiry check both want: not "is there a
 * row in the table" but "given today's date, does a live LUT justify B, or are we
 * declaring C". Those differ the moment an LUT lapses, which is the failure this
 * whole feature exists to prevent — so the answer has to come from the same
 * resolver the label path uses, never from a separate reading of the data.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const country =
    typeof req.query.country === "string" && req.query.country
      ? req.query.country
      : undefined

  const resolution = await resolveExportIgstForCountry(req.scope, country)

  res.json({
    export_igst: {
      ...resolution,
      /** "B" = LUT/bond on file, no IGST paid. "C" = IGST paid and reclaimed. */
      declares_under_lut: resolution.status === "B",
    },
  })
}
