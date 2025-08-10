import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getFolderDetailWorkflow } from "../../../../../../workflows/media/get-folder-detail"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id: string }

  const { result, errors } = await getFolderDetailWorkflow(req.scope).run({
    input: {
      id,
      config: {
        relations: ["parent_folder", "child_folders", "media_files"],
      },
    },
  })

  if (errors?.length) {
    return res.status(500).json({ message: "Failed to fetch folder detail", errors })
  }

  return res.json({
    ...result,
  })
}
