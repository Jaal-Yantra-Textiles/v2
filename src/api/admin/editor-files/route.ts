import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { listEditorFilesWorkflow } from "../../../workflows/files/list-editor-files"
import { MedusaError } from "@medusajs/utils"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { limit, offset, q, mime_type_group } = req.query

  const parsedLimit = limit ? parseInt(limit as string, 10) : 20
  const parsedOffset = offset ? parseInt(offset as string, 10) : 0

  if (isNaN(parsedLimit) || isNaN(parsedOffset)) {
    return res.status(400).json({ message: "Invalid limit or offset." })
  }
    const { result } = await listEditorFilesWorkflow(req.scope).run({
      input: {
        pagination: { // Workflow expects pagination object
          limit: parsedLimit,
          offset: parsedOffset,
        }
        // q and mime_type_group are no longer passed as they are not supported by the workflow
      },
      throwOnError: true,
    })

    res.status(200).json(result)
  }
