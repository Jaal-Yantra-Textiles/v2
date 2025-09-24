import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { deleteMediaFileWorkflow } from "../../../../../workflows/media/delete-media-file"

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { id } = req.params as { id: string }
    if (!id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing media file id")
    }

    const { errors } = await deleteMediaFileWorkflow(req.scope).run({ input: { id } })
    if (errors.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to delete media file: ${errors.map((e) => e.error?.message || "Unknown").join(", ")}`
      )
    }

    return res.status(200).json({ id, deleted: true })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error while deleting media file" })
  }
}
