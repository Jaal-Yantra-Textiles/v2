import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const fileService = req.scope.resolve(Modules.FILE)
  const input = req.files as Express.Multer.File[]

  if (!input?.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No files provided"
    )
  }

  const files = await fileService.createFiles(
    input.map((f) => ({
      filename: f.originalname,
      mimeType: f.mimetype,
      content: f.buffer.toString("binary"),
      access: "public" as const,
    }))
  )

  res.json({ files })
}
