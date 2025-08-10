import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getMediaDictionariesWorkflow } from "../../../../workflows/media/get-dictionaries"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result, errors } = await getMediaDictionariesWorkflow(req.scope).run()
  if (errors?.length) {
    return res.status(500).json({ message: errors.map((e: any) => e?.error?.message).filter(Boolean).join("; ") })
  }
  res.status(200).json(result)
}
