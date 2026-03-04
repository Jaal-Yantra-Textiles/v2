import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { uploadAndOrganizeMediaWorkflow } from "../media/upload-and-organize-media"
import { MEDIA_MODULE } from "../../modules/media"
import MediaFileService from "../../modules/media/service"

// ---------------------------------------------------------------------------
// Stock model presets (neutral, royalty-free placeholder URLs)
// Replace these with your own hosted model photos for production use.
// ---------------------------------------------------------------------------
const MODEL_PRESETS: Record<string, string> = {
  female_default:
    "https://images.unsplash.com/photo-1581044777550-4cfa60707c03?w=768&q=80",
  male_default:
    "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=768&q=80",
  female_casual:
    "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=768&q=80",
  male_casual:
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=768&q=80",
}

function resolveModelUrl(gender: string, preset?: string): string {
  if (preset && MODEL_PRESETS[preset]) return MODEL_PRESETS[preset]
  return gender === "male" ? MODEL_PRESETS.male_default : MODEL_PRESETS.female_default
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TryOnGarmentInput = {
  customer_id: string
  garment_image_url?: string
  garment_image_base64?: string
  face_image_base64: string
  cloth_type: "upper_body" | "lower_body" | "dresses"
  gender: "male" | "female"
  model_preset?: string
}

type CatVtonResult = {
  tryon_image_url: string
}

type FaceSwapResult = {
  result_image_url: string
}

type UploadResult = {
  media_id: string
  media_url: string
}

// ---------------------------------------------------------------------------
// Helper: upload a base64 image to fal.ai storage and return a public URL
// ---------------------------------------------------------------------------
async function uploadBase64ToFal(base64DataUrl: string): Promise<string> {
  // Dynamic import so the module is only loaded at runtime
  const { fal } = await import("@fal-ai/client")
  fal.config({ credentials: process.env.FAL_KEY })

  // Extract raw base64 and mime type
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
// Step 1: Virtual try-on via CatVTON (garment → person wearing garment)
// ---------------------------------------------------------------------------
const catVtonStep = createStep(
  "cat-vton-step",
  async (input: TryOnGarmentInput): Promise<StepResponse<CatVtonResult, null>> => {
    const { fal } = await import("@fal-ai/client")
    fal.config({ credentials: process.env.FAL_KEY })

    const modelUrl = resolveModelUrl(input.gender, input.model_preset)

    // Resolve garment URL (upload base64 if needed)
    let garmentUrl: string
    if (input.garment_image_base64) {
      garmentUrl = await uploadBase64ToFal(input.garment_image_base64)
    } else if (input.garment_image_url) {
      garmentUrl = input.garment_image_url
    } else {
      throw new Error("Either garment_image_url or garment_image_base64 is required")
    }

    console.log(`[TryOn] Running CatVTON — model: ${modelUrl.substring(0, 60)}…`)

    const result = await fal.subscribe("fal-ai/cat-vton", {
      input: {
        human_image_url: modelUrl,
        garment_image_url: garmentUrl,
        cloth_type: input.cloth_type,
      },
    })

    const imageUrl = (result as any)?.image?.url || (result as any)?.output?.image?.url
    if (!imageUrl) {
      throw new Error("CatVTON returned no image URL")
    }

    console.log(`[TryOn] CatVTON success: ${imageUrl.substring(0, 80)}…`)
    return new StepResponse({ tryon_image_url: imageUrl }, null)
  },
  async () => {}
)

// ---------------------------------------------------------------------------
// Step 2: Face swap — replace stock model face with customer's face
// ---------------------------------------------------------------------------
type FaceSwapInput = {
  tryon_image_url: string
  face_image_base64: string
  gender: "male" | "female"
}

const faceSwapStep = createStep(
  "face-swap-step",
  async (input: FaceSwapInput): Promise<StepResponse<FaceSwapResult, null>> => {
    const { fal } = await import("@fal-ai/client")
    fal.config({ credentials: process.env.FAL_KEY })

    // Upload face image to fal storage
    const faceUrl = await uploadBase64ToFal(input.face_image_base64)

    console.log(`[TryOn] Running face-swap — target: ${input.tryon_image_url.substring(0, 60)}…`)

    const result = await fal.subscribe("easel-ai/advanced-face-swap", {
      input: {
        face_image_0: faceUrl,
        target_image: input.tryon_image_url,
        gender_0: input.gender,
        workflow_type: "target_hair",
      },
    })

    const imageUrl = (result as any)?.image?.url || (result as any)?.output?.image?.url
    if (!imageUrl) {
      throw new Error("Face swap returned no image URL")
    }

    console.log(`[TryOn] Face-swap success: ${imageUrl.substring(0, 80)}…`)
    return new StepResponse({ result_image_url: imageUrl }, null)
  },
  async () => {}
)

// ---------------------------------------------------------------------------
// Step 3: Upload final image to Medusa media storage (R2)
// ---------------------------------------------------------------------------
type UploadTryOnImageInput = {
  result_image_url: string
  customer_id: string
}

const uploadTryOnImageStep = createStep(
  "upload-tryon-image-step",
  async (input: UploadTryOnImageInput, { container }): Promise<StepResponse<UploadResult, string>> => {
    console.log(`[TryOn] Fetching result image: ${input.result_image_url.substring(0, 80)}…`)

    const response = await fetch(input.result_image_url)
    if (!response.ok) {
      throw new Error(`Failed to fetch try-on result image: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const mimeType = response.headers.get("content-type") || "image/jpeg"
    const extension = mimeType.split("/")[1] || "jpg"
    const base64Content = buffer.toString("base64")
    const filename = `tryon-${input.customer_id}-${Date.now()}.${extension}`

    console.log(`[TryOn] Uploading ${filename} (${buffer.length} bytes)`)

    // Find or create try-on folder
    const mediaService: MediaFileService = container.resolve(MEDIA_MODULE)
    let existingFolderId: string | undefined

    try {
      const folders = await mediaService.listFolders({ slug: "tryon-results" })
      if (folders?.length > 0) existingFolderId = folders[0].id
    } catch {
      // folder not found — will be created
    }

    const { result: mediaResult } = await uploadAndOrganizeMediaWorkflow(container).run({
      input: {
        files: [{ filename, mimeType, content: base64Content }],
        ...(existingFolderId
          ? { existingFolderId }
          : {
              folder: {
                name: "tryon-results",
                description: "Virtual try-on result images",
                parent_folder_id: undefined,
              },
            }),
        metadata: {
          source: "tryon",
          customer_id: input.customer_id,
          generated_at: new Date().toISOString(),
        },
      },
    })

    const uploadedMedia = mediaResult?.mediaFiles?.[0]
    if (!uploadedMedia) throw new Error("Media upload failed — no media file returned")

    console.log(`[TryOn] Upload success: ${uploadedMedia.file_path}`)

    return new StepResponse(
      { media_id: uploadedMedia.id, media_url: uploadedMedia.file_path },
      uploadedMedia.id
    )
  },
  async () => {}
)

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------
export const tryOnGarmentWorkflow = createWorkflow(
  "try-on-garment",
  (input: TryOnGarmentInput) => {
    // Step 1: CatVTON — put garment on stock model
    const catVtonResult = catVtonStep(input)

    // Step 2: Face swap — replace stock model face with customer face
    const faceSwapInput = transform(
      { input, catVtonResult },
      (data) => ({
        tryon_image_url: data.catVtonResult.tryon_image_url,
        face_image_base64: data.input.face_image_base64,
        gender: data.input.gender,
      })
    )
    const faceSwapResult = faceSwapStep(faceSwapInput)

    // Step 3: Upload to R2
    const uploadInput = transform(
      { input, faceSwapResult },
      (data) => ({
        result_image_url: data.faceSwapResult.result_image_url,
        customer_id: data.input.customer_id,
      })
    )
    const uploadResult = uploadTryOnImageStep(uploadInput)

    const response = transform(
      { uploadResult },
      (data) => ({
        result_url: data.uploadResult.media_url,
        media_id: data.uploadResult.media_id,
      })
    )

    return new WorkflowResponse(response)
  }
)
