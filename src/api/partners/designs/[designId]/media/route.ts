import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../../helpers"
import designPartnersLink from "../../../../../links/design-partners-link"

// POST /partners/designs/:designId/media
// Uploads media files for a design by an authenticated partner admin and returns file URLs
export const POST = async (
  req: AuthenticatedMedusaRequest & { files?: Express.Multer.File[]; file?: Express.Multer.File },
  res: MedusaResponse
) => {
  try {
    // 1) Partner auth (Admin acting on behalf of Partner)
    const adminId = req.auth_context?.actor_id
    const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope)
    console.log("[partners/designs/:designId/media] auth", { adminId, partnerFound: !!partnerAdmin, partnerId: partnerAdmin?.id })
    if (!partnerAdmin) {
      return res.status(401).json({ error: "Partner authentication required" })
    }

    const { designId } = (req.params || {}) as { designId?: string }
    if (!designId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Design ID is required")
    }

    // 2) Verify this design is linked to this partner via link graph
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const linkResult = await query.graph({
      entity: designPartnersLink.entryPoint,
      fields: ["design.id", "partner.id"],
      filters: { design_id: designId, partner_id: partnerAdmin.id },
      pagination: { skip: 0, take: 1 },
    })
    const linkData = (linkResult?.data || [])[0]
    console.log("[partners/designs/:designId/media] linkResult", { designId, partnerId: partnerAdmin.id, linkData })
    if (!linkData || !linkData.design?.id) {
      return res.status(404).json({ error: "Design not found for this partner", designId, partnerId: partnerAdmin.id })
    }

    // 3) Normalize uploaded files
    const uploadedFiles: Express.Multer.File[] = Array.isArray(req.files)
      ? (req.files as Express.Multer.File[])
      : (req.file ? [req.file as Express.Multer.File] : [])

    if (!uploadedFiles || uploadedFiles.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "No files provided for upload")
    }
    console.log("[partners/designs/:designId/media] incoming files", uploadedFiles.map(f => ({ name: f.originalname, type: f.mimetype, size: f.size })))

    // 4) Upload per-file using core flow (content as binary string) with access: "public"
    const results: Array<{ id?: string; url: string }> = []
    for (let i = 0; i < uploadedFiles.length; i++) {
      const f = uploadedFiles[i] as any
      const payload = {
        filename: f.originalname,
        mimeType: f.mimetype,
        content: f.buffer?.toString("binary"),
        access: "public" as const,
      }
      if (!payload.content) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Missing file content for index ${i}`)
      }
      const out = await uploadFilesWorkflow.run({ input: { files: [payload] } })
      console.log("[partners/designs/:designId/media] upload result", out?.result)
      const resu = out.result
      const arr = Array.isArray(resu)
        ? resu
        : (resu && (resu as any).files && Array.isArray((resu as any).files))
          ? (resu as any).files
          : (resu && (resu as any).uploaded && Array.isArray((resu as any).uploaded))
            ? (resu as any).uploaded
            : []
      if (arr.length) {
        const file = arr[0] as any
        results.push({ id: file.id, url: file.url || file.location || file.key })
      }
    }

    return res.status(200).json({ files: results })
  } catch (e) {
    console.error("[partners/designs/:designId/media] error", e)
    if (e instanceof MedusaError) {
      return res.status(400).json({ error: e.message, type: e.type })
    }
    return res.status(500).json({ error: "Unexpected server error" })
  }
}
