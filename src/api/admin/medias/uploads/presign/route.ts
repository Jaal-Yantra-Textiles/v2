import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"

interface PresignBody {
  name: string
  type: string
  size: number
  access?: "public" | "private"
}

export const POST = async (req: MedusaRequest<PresignBody>, res: MedusaResponse) => {
  try {
    const body = (req as any).validatedBody || (req.body as any)
    let name = (body?.name as string) || (body?.file_name as string) || (body?.filename as string)
    const type = (body?.type as string) || (body?.mime_type as string) || (body?.content_type as string)
    const size = Number(body?.size)
    const access = (body?.access as "public" | "private") || "public"

    // Generate a filename if missing and provider complains
    if (!name) {
      const extFromType = typeof type === "string" && type.includes("/") ? type.split("/").pop() : "bin"
      name = `upload-${Date.now()}.${extFromType || "bin"}`
    }
    if (!type || !Number.isFinite(size)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing required fields: type, size")
    }

    // Resolve File Service and provider from DI
    const fileService: any = req.scope.resolve(Modules.FILE)
    if (!fileService?.getProvider) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "File service provider not available")
    }

    const provider = await fileService.getProvider()
    if (!provider?.getPresignedUploadUrl) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Active file provider does not support presigned uploads")
    }

    const extension = (name.includes(".") ? name.split(".").pop() : undefined) || (typeof type === "string" && type.includes("/") ? type.split("/").pop() : undefined)
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
      access,
    })
    // Expect shape: { url, file_key, name, type, size, extension? }

    return res.status(200).json(resp)
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error generating presigned URL" })
  }
}
