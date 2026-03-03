import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listActions } from "../../../../utils/inbound-email-actions"

// Ensure actions are registered
import "../../../../utils/inbound-email-actions/create-inventory-order"

export const GET = async (
  _req: MedusaRequest,
  res: MedusaResponse
) => {
  const actions = listActions().map((a) => ({
    type: a.type,
    label: a.label,
    description: a.description,
  }))

  res.status(200).json({ actions })
}
