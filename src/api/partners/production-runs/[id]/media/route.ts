import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const id = req.params.id

  const productionRunService: ProductionRunService =
    req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = await productionRunService
    .retrieveProductionRun(id)
    .catch(() => null)

  if (!run || (run as any).partner_id !== partnerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${id} not found`
    )
  }

  const rawFiles = Array.isArray((req as any).files)
    ? (req as any).files
    : (req as any).file
      ? [(req as any).file]
      : []

  if (!rawFiles.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No files provided for upload"
    )
  }

  const results: Array<{ id?: string; url: string }> = []

  for (let i = 0; i < rawFiles.length; i++) {
    const f = rawFiles[i]
    const content = f.buffer?.toString("base64")

    if (!content) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Missing file content for index ${i}`
      )
    }

    const { result: resu } = await uploadFilesWorkflow(req.scope).run({
      input: {
        files: [
          {
            filename: f.originalname,
            mimeType: f.mimetype,
            content,
            access: "public",
          },
        ],
      },
    })

    const uploaded = Array.isArray(resu)
      ? resu
      : Array.isArray((resu as any)?.files)
        ? (resu as any).files
        : Array.isArray((resu as any)?.uploaded)
          ? (resu as any).uploaded
          : []

    const file = uploaded[0]
    if (file) {
      results.push({
        id: file.id,
        url: file.url || file.location || file.key,
      })
    }
  }

  return res.status(200).json({ files: results })
}
