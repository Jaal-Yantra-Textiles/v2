import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getFolderWorkflow } from "../../../../../workflows/media/get-folder"

// GET /admin/medias/folder/:id
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params as { id?: string }
    if (!id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Folder ID is required")
    }

    const { result, errors } = await getFolderWorkflow(req.scope).run({
      input: {
        id,
        // keep light by default; UI can call /detail for the composite view
        config: { relations: ["parent_folder"] },
      },
    })

    if (errors?.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to fetch folder: ${errors.map((e) => e.error?.message || "Unknown error").join(", ")}`
      )
    }

    return res.status(200).json({ folder: result })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: "An unexpected error occurred" })
  }
}
