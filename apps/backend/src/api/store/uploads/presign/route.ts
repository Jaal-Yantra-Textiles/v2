import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"

interface StorePresignBody {
  name?: string
  type: string
  size: number
}

/**
 * POST /store/uploads/presign
 *
 * Generates a presigned S3 upload URL for authenticated customers.
 * Used by the storefront design editor to upload image layers directly
 * to storage, avoiding base64 encoding in design payloads.
 *
 * Returns: { url, file_key, public_url }
 *   - url: presigned PUT URL for direct browser upload
 *   - file_key: the storage key (path) of the uploaded file
 *   - public_url: the permanent public URL to store in the design layer
 */
export const POST = async (req: MedusaRequest<StorePresignBody>, res: MedusaResponse) => {
  try {
    const body = (req as any).validatedBody || (req.body as any)
    const type = (body?.type as string) || (body?.mime_type as string)
    const size = Number(body?.size)
    let name = (body?.name as string) || (body?.filename as string)

    if (!name) {
      const ext = type?.includes("/") ? type.split("/").pop() : "bin"
      name = `design-layer-${Date.now()}.${ext || "bin"}`
    }

    if (!type || !Number.isFinite(size)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing required fields: type, size")
    }

    const fileService: any = req.scope.resolve(Modules.FILE)
    if (!fileService?.getProvider) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "File service provider not available")
    }

    const provider = await fileService.getProvider()
    if (!provider?.getPresignedUploadUrl) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Active file provider does not support presigned uploads")
    }

    const extension = name.includes(".") ? name.split(".").pop() : type.split("/").pop()
    const resp = await provider.getPresignedUploadUrl({
      name,
      file_name: name,
      filename: name,
      original_name: name,
      type,
      mime_type: type,
      content_type: type,
      size,
      extension,
      access: "public",
    })

    // Build public URL for the uploaded file
    const base = (process.env.FILE_PUBLIC_BASE || process.env.S3_FILE_URL)?.replace(/\/$/, "")
    const file_key: string = resp.file_key || resp.key || resp.path
    const public_url = base
      ? `${base}/${file_key.replace(/^\/+/, "")}`
      : resp.url?.split("?")[0] // strip query params from presigned URL as fallback

    return res.status(200).json({
      url: resp.url,
      file_key,
      public_url,
    })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error generating presigned URL" })
  }
}
