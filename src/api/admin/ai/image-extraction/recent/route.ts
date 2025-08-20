import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { listImageExtractionAuditWorkflow } from "../../../../../workflows/ai/list-image-extraction-audit";

// GET /admin/ai/image-extraction/recent?resource=<id>&prefix=<prefix>&limit=<n>
// Returns a list of recent image extraction memory entries.
// NOTE: Querying Mastra memory is not wired yet; returns [] for now if unsupported.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const resource = (req.query.resource as string) || undefined
    const prefix = (req.query.prefix as string) || "image-extraction:"
    const limit = Math.min(parseInt((req.query.limit as string) || "10", 10) || 10, 50)

    const { result } = await listImageExtractionAuditWorkflow(req.scope).run({
      input: { resource, prefix, limit },
    })

    return res.status(200).json(result)
  } catch (e) {
    const err = e as Error
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: err.message })
    }
    return res.status(500).json({ message: err.message || "Unexpected error" })
  }
}
