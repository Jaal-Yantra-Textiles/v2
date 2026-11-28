import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"

/**
 * Store a shipping label PDF in the file module (S3 in prod) and return its
 * public URL, so a label that a carrier hands back as bytes (DTDC returns
 * base64) or an admin uploads (India Post) becomes a lasting `label_url`.
 */
export async function storeLabelPdf(
  container: MedusaContainer,
  input: { awb: string; base64: string; filename?: string }
): Promise<string> {
  const safe = String(input.awb || "label").replace(/[^A-Za-z0-9_-]/g, "") || "label"
  const { result } = await uploadFilesWorkflow(container).run({
    input: {
      files: [
        {
          filename: input.filename || `label-${safe}.pdf`,
          mimeType: "application/pdf",
          content: input.base64,
          access: "public",
        },
      ],
    },
  })
  const files: any[] = Array.isArray(result)
    ? result
    : ((result as any)?.files ?? (result as any)?.uploaded ?? [])
  const url = files?.[0]?.url
  if (!url) {
    throw new Error("Label upload returned no URL")
  }
  return url
}

/** A carrier label returned as bytes, if that is what this one is. */
export function labelBase64(label: any): string | null {
  const data = label?.data
  if (typeof data !== "string" || data.length < 100) return null
  const fmt = String(label?.format || "pdf").toLowerCase()
  return fmt.includes("pdf") || fmt === "base64" ? data : null
}
