import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TryOnGarmentInput = {
  customer_id: string
  garment_image_url?: string
  garment_image_base64?: string
  face_image_base64: string
  cloth_type: "upper_body" | "lower_body" | "dress"
  gender: "male" | "female"
}

// CatVTON expects different cloth_type values than our internal enum
const CATVTON_CLOTH_TYPE_MAP: Record<string, string> = {
  upper_body: "upper",
  lower_body: "lower",
  dress: "overall",
}

// ---------------------------------------------------------------------------
// Helper: upload a base64 image to fal.ai storage and return a public URL
// ---------------------------------------------------------------------------
async function uploadBase64ToFal(base64DataUrl: string): Promise<string> {
  const { fal } = await import("@fal-ai/client")
  fal.config({ credentials: process.env.FAL_KEY })

  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error("Invalid base64 data URL")
  const [, mimeType, base64Content] = match
  const extension = mimeType.split("/")[1] || "png"

  const buffer = Buffer.from(base64Content, "base64")
  const blob = new Blob([buffer], { type: mimeType })
  const file = new File([blob], `upload.${extension}`, { type: mimeType })

  const url = await fal.storage.upload(file)
  return url
}

// ---------------------------------------------------------------------------
// Step: Virtual try-on via CatVTON using customer's face photo directly
// ---------------------------------------------------------------------------
const catVtonStep = createStep(
  "cat-vton-step",
  async (input: TryOnGarmentInput): Promise<StepResponse<{ result_url: string }, null>> => {
    const { fal } = await import("@fal-ai/client")
    fal.config({ credentials: process.env.FAL_KEY })

    // Upload face photo to fal storage (becomes human_image_url)
    console.log("[TryOn] Uploading face image to fal storage…")
    const humanUrl = await uploadBase64ToFal(input.face_image_base64)

    // Resolve garment URL (upload base64 if needed, or use URL directly)
    let garmentUrl: string
    if (input.garment_image_url) {
      garmentUrl = input.garment_image_url
    } else if (input.garment_image_base64) {
      console.log("[TryOn] Uploading garment image to fal storage…")
      garmentUrl = await uploadBase64ToFal(input.garment_image_base64)
    } else {
      throw new Error("Either garment_image_url or garment_image_base64 is required")
    }

    console.log(`[TryOn] Running CatVTON — human: ${humanUrl.substring(0, 60)}… garment: ${garmentUrl.substring(0, 60)}…`)

    const result = await fal.subscribe("fal-ai/cat-vton", {
      input: {
        human_image_url: humanUrl,
        garment_image_url: garmentUrl,
        cloth_type: CATVTON_CLOTH_TYPE_MAP[input.cloth_type] ?? "upper",
      } as any,
    })

    const imageUrl = (result as any)?.data?.image?.url
    if (!imageUrl) {
      console.error("[TryOn] CatVTON result shape:", JSON.stringify(result).substring(0, 300))
      throw new Error("CatVTON returned no image URL")
    }

    console.log(`[TryOn] CatVTON success: ${imageUrl.substring(0, 80)}…`)
    return new StepResponse({ result_url: imageUrl }, null)
  },
  async () => {}
)

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------
export const tryOnGarmentWorkflow = createWorkflow(
  "try-on-garment",
  (input: TryOnGarmentInput) => {
    const catVtonResult = catVtonStep(input)
    return new WorkflowResponse({
      result_url: catVtonResult.result_url,
      media_id: null,
    })
  }
)
