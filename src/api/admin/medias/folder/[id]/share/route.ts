import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import crypto from "crypto"
import { getFolderWorkflow } from "../../../../../../workflows/media/get-folder"
import { updateFolderWorkflow } from "../../../../../../workflows/media/update-folder"

const ensureFolder = async (scope: any, id?: string) => {
  if (!id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Folder ID is required")
  }

  const { result, errors } = await getFolderWorkflow(scope).run({
    input: {
      id,
      config: {
        relations: ["parent_folder"],
      },
    },
  })

  if (errors?.length || !result) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Folder ${id} could not be found`
    )
  }

  return result as any
}

const updateFolderShareState = async (
  scope: any,
  input: { id: string; is_public: boolean; metadata: Record<string, any> | null }
) => {
  const { result, errors } = await updateFolderWorkflow(scope).run({
    input,
  })

  if (errors?.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      errors.map((e) => e.error?.message || "Failed to update folder").join(", ")
    )
  }

  return result
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id?: string }
  const folder = await ensureFolder(req.scope, id)

  const token = crypto.randomBytes(16).toString("hex")
  const metadata = {
    ...(folder.metadata || {}),
    share_token: token,
  }

  const updated = await updateFolderShareState(req.scope, {
    id: folder.id,
    is_public: true,
    metadata,
  })

  return res.status(200).json({ folder: updated, share_token: token })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id?: string }
  const folder = await ensureFolder(req.scope, id)

  const metadata = { ...(folder.metadata || {}) }
  delete metadata.share_token

  const nextMetadata = Object.keys(metadata).length ? metadata : null

  const updated = await updateFolderShareState(req.scope, {
    id: folder.id,
    is_public: false,
    metadata: nextMetadata,
  })

  return res.status(200).json({ folder: updated })
}
