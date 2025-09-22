import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"

// Deprecated endpoint: Inventory reporting is now handled via
// POST /partners/designs/:designId/complete with an optional `consumptions` payload.
// See src/api/partners/designs/[designId]/complete/route.ts
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  return res.status(410).json({
    error: "This endpoint is deprecated",
    message: "Report inventory via POST /partners/designs/:designId/complete with { consumptions: [{ inventory_item_id, quantity, location_id? }] }.",
  })
}
