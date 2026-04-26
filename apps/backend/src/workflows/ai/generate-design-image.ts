import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk";
import { mastra } from "../../mastra";
import { uploadAndOrganizeMediaWorkflow } from "../media/upload-and-organize-media";
import { createDesignWorkflow } from "../designs/create-design";
import { DESIGN_MODULE } from "../../modules/designs";
import DesignService from "../../modules/designs/service";
import { MEDIA_MODULE } from "../../modules/media";
import MediaFileService from "../../modules/media/service";

type Badge = {
  style?: string;
  color_family?: string;
  body_type?: string;
  embellishment_level?: string;
  occasion?: string;
  budget_sensitivity?: string;
  custom?: Record<string, any>;
};

type ReferenceImage = {
  url: string;
  weight?: number;
  prompt?: string;
};

type CanvasSnapshot = {
  width: number;
  height: number;
  layers: Array<{
    id: string;
    type: "image" | "text" | "shape";
    data: Record<string, any>;
  }>;
};

export type GenerateDesignAiImageInput = {
  customer_id: string;
  design_id?: string;
  mode: "preview" | "commit";
  badges?: Badge;
  materials_prompt?: string;
  reference_images?: ReferenceImage[];
  canvas_snapshot?: CanvasSnapshot;
  preview_cache_key?: string;
};

type MastraImageGenResult = {
  image_url?: string;
  prompt_used: string;
  quota_remaining?: number;
};

type UploadResult = {
  media_id: string;
  media_url: string;
};

// Step 1: Invoke Mastra workflow for image generation
const invokeMastraImageGenStep = createStep(
  "invoke-mastra-image-gen-step",
  async (input: GenerateDesignAiImageInput): Promise<StepResponse<MastraImageGenResult, { imageUrl?: string; mode: string }>> => {
    try {
      const workflow = mastra.getWorkflow("imageGenerationWorkflow");

      if (!workflow) {
        throw new Error("Image generation workflow not found in Mastra");
      }

      // Create run and start workflow
      const run = await workflow.createRun();
      const result = await run.start({
        inputData: {
          mode: input.mode,
          badges: input.badges,
          materials_prompt: input.materials_prompt,
          reference_images: input.reference_images,
          canvas_snapshot: input.canvas_snapshot,
          preview_cache_key: input.preview_cache_key,
          customer_id: input.customer_id,
        },
      });

      // Check workflow status
      if (result.status === "failed") {
        throw new Error("Image generation workflow failed");
      }

      // The workflow output is the final step's output (only available on success)
      if (result.status !== "success") {
        throw new Error("Image generation workflow did not complete successfully");
      }

      // Now TypeScript knows result.status === "success", so result.result exists
      const output = result.result as {
        image_url?: string;
        enhanced_prompt: string;
        style_context: string;
        quota_remaining: number;
        error?: string;
      } | undefined;

      if (!output) {
        throw new Error("No output from image generation workflow");
      }

      if (output.error) {
        throw new Error(output.error);
      }

      return new StepResponse(
        {
          image_url: output?.image_url,
          prompt_used: output?.enhanced_prompt || "AI-generated design",
          quota_remaining: output?.quota_remaining,
        },
        { imageUrl: output?.image_url, mode: input.mode }
      );
    } catch (error: any) {
      throw new Error(`Mastra workflow failed: ${error?.message || error}`);
    }
  },
  async () => {
    // Rollback: no-op since we haven't persisted anything yet
  }
);

// Step 2: Upload image to media storage (only for commit mode)
type UploadImageInput = {
  image_url: string;
  customer_id: string;
  badges?: Badge;
  materials_prompt?: string;
  prompt_used?: string;
};

const uploadGeneratedImageStep = createStep(
  "upload-generated-image-step",
  async (input: UploadImageInput, { container }): Promise<StepResponse<UploadResult, string>> => {
    let base64Content: string;
    let mimeType: string = "image/png";

    // Check if the image_url is a base64 data URL
    if (input.image_url.startsWith("data:")) {
      // Parse base64 data URL - keep the base64 string directly
      const matches = input.image_url.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        throw new Error("Invalid base64 data URL format");
      }
      mimeType = matches[1];
      base64Content = matches[2]; // Use base64 directly, don't convert to Buffer

      // Calculate size from base64 (for logging only)
      const sizeBytes = Math.floor(base64Content.length * 3 / 4);
      console.log(`[AI ImageGen Upload] Processing base64 image, ~size: ${sizeBytes} bytes, mimeType: ${mimeType}`);
    } else {
      // Fetch the image from the URL and convert to base64
      console.log(`[AI ImageGen Upload] Fetching image from URL: ${input.image_url.substring(0, 100)}...`);
      const response = await fetch(input.image_url);

      if (!response.ok) {
        throw new Error(`Failed to fetch generated image: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      base64Content = buffer.toString("base64"); // Convert to base64 for Medusa
      mimeType = response.headers.get("content-type") || "image/png";
      console.log(`[AI ImageGen Upload] Fetched image, size: ${buffer.length} bytes, mimeType: ${mimeType}`);
    }

    // Determine filename and extension
    const timestamp = Date.now();
    const extension = mimeType.split("/")[1] || "png";
    const filename = `ai-design-${input.customer_id}-${timestamp}.${extension}`;

    console.log(`[AI ImageGen Upload] Uploading to media: ${filename}`);

    // Try to find existing "ai-designs" folder
    const mediaService: MediaFileService = container.resolve(MEDIA_MODULE);
    let existingFolderId: string | undefined;

    try {
      const folders = await mediaService.listFolders({ slug: "ai-designs" });
      if (folders && folders.length > 0) {
        existingFolderId = folders[0].id;
        console.log(`[AI ImageGen Upload] Found existing ai-designs folder: ${existingFolderId}`);
      }
    } catch (e) {
      // Folder lookup failed, we'll create a new one
      console.log(`[AI ImageGen Upload] Could not find existing folder, will create new one`);
    }

    // Upload using the existing media workflow
    // Use existingFolderId if found, otherwise create a new folder
    // IMPORTANT: Pass base64 content directly - Medusa's uploadFilesWorkflow expects base64
    const { result: mediaResult } = await uploadAndOrganizeMediaWorkflow(container).run({
      input: {
        files: [{
          filename,
          mimeType,
          content: base64Content, // Pass base64 directly
        }],
        // Use existing folder ID if available, otherwise create new folder
        ...(existingFolderId
          ? { existingFolderId }
          : {
              folder: {
                name: "ai-designs",
                description: "AI-generated design images",
                parent_folder_id: undefined,
              },
            }),
        metadata: {
          badges: input.badges || {},
          materials_prompt: input.materials_prompt || "",
          prompt_used: input.prompt_used || "",
          source: "ai-mistral",
          customer_id: input.customer_id,
          generated_at: new Date().toISOString(),
        },
      },
    });

    const uploadedMedia = mediaResult?.mediaFiles?.[0];

    if (!uploadedMedia) {
      throw new Error("Media upload failed - no media file returned");
    }

    console.log(`[AI ImageGen Upload] Upload successful: ${uploadedMedia.file_path}`);

    return new StepResponse(
      {
        media_id: uploadedMedia.id,
        media_url: uploadedMedia.file_path,
      },
      uploadedMedia.id
    );
  },
  async () => {
    // Rollback: handled by uploadAndOrganizeMediaWorkflow's own rollback
  }
);

// Step 3: Update design with AI media metadata (only for commit mode with design_id)
type UpdateDesignMetadataInput = {
  design_id: string;
  media_id: string;
  media_url: string;
  badges?: Badge;
  materials_prompt?: string;
  prompt_used: string;
};

const updateDesignWithAiMediaStep = createStep(
  "update-design-with-ai-media-step",
  async (input: UpdateDesignMetadataInput, { container }): Promise<StepResponse<{ success: boolean }, Record<string, any> | null>> => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);

    const design = await designService.retrieveDesign(input.design_id);

    // Update design metadata and origin_source
    const updatedMetadata = {
      ...design.metadata,
      ai_media: {
        media_id: input.media_id,
        preview_url: input.media_url,
        badges: input.badges || {},
        materials_prompt: input.materials_prompt || "",
        prompt_used: input.prompt_used,
        generated_at: new Date().toISOString(),
      },
    };

    await designService.updateDesigns({
      id: input.design_id,
      metadata: updatedMetadata,
      origin_source: "ai-mistral",
      thumbnail_url: input.media_url,
    });

    return new StepResponse({ success: true }, design.metadata as Record<string, any> | null);
  },
  async () => {
    // Rollback: restore original metadata (not critical for MVP)
  }
);

// Step 4: Create a new design entry for AI generation history
// Now uses createDesignWorkflow.runAsStep() for proper workflow composition

// Main workflow
export const generateDesignAiImageWorkflow = createWorkflow(
  "generate-design-ai-image",
  (input: GenerateDesignAiImageInput) => {
    // Step 1: Generate image via Mastra
    const mastraResult = invokeMastraImageGenStep(input);

    // Step 2: Always upload to media storage (both preview and commit modes)
    // This ensures we return a proper URL instead of a large base64 string
    // Use transform to prepare input from step results
    const uploadInput = transform(
      { input, mastraResult },
      (data) => ({
        image_url: data.mastraResult.image_url || "",
        customer_id: data.input.customer_id,
        badges: data.input.badges,
        materials_prompt: data.input.materials_prompt,
        prompt_used: data.mastraResult.prompt_used,
      })
    );

    // Always upload if we have an image URL
    const uploadResult = when(
      "upload-generated-image",
      { mastraResult },
      (data) => !!data.mastraResult.image_url
    ).then(() => {
      return uploadGeneratedImageStep(uploadInput);
    });

    // Step 3: If commit mode AND design_id provided, update design metadata
    // Use transform to prepare input from previous step results
    const updateDesignInput = transform(
      { input, mastraResult, uploadResult },
      (data) => ({
        design_id: data.input.design_id || "",
        media_id: data.uploadResult?.media_id || "",
        media_url: data.uploadResult?.media_url || "",
        badges: data.input.badges,
        materials_prompt: data.input.materials_prompt,
        prompt_used: data.mastraResult.prompt_used,
      })
    );

    when(
      "update-design-if-commit-with-id",
      { input, uploadResult },
      (data) => data.input.mode === "commit" && !!data.input.design_id && !!data.uploadResult
    ).then(() => {
      return updateDesignWithAiMediaStep(updateDesignInput);
    });

    // Step 4: Always create a design entry to save AI generation history
    // Uses createDesignWorkflow.runAsStep() for proper workflow composition
    // This ensures customers can see their AI generations across sessions
    const createDesignInput = transform(
      { input, mastraResult, uploadResult },
      (data) => {
        const timestamp = new Date().toISOString();
        const shortTimestamp = new Date().toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        return {
          name: `AI Design - ${shortTimestamp}`,
          description: data.mastraResult.prompt_used || "AI-generated design",
          design_type: "Custom" as const,
          status: "Conceptual" as const,
          priority: "Medium" as const,
          origin_source: "ai-mistral" as const,
          thumbnail_url: data.uploadResult?.media_url || "",
          media_files: data.uploadResult?.media_id
            ? [
                {
                  id: data.uploadResult.media_id,
                  url: data.uploadResult.media_url,
                  isThumbnail: true,
                },
              ]
            : undefined,
          metadata: {
            ai_generation: {
              media_id: data.uploadResult?.media_id || "",
              preview_url: data.uploadResult?.media_url || "",
              badges: data.input.badges || {},
              materials_prompt: data.input.materials_prompt || "",
              prompt_used: data.mastraResult.prompt_used,
              generated_at: timestamp,
            },
          },
          tags: ["ai-generated", "auto-saved"],
          customer_id_for_link: data.input.customer_id,
        };
      }
    );

    const createDesignResult = when(
      "create-ai-design-history",
      { uploadResult },
      (data) => !!data.uploadResult?.media_id
    ).then(() => {
      // Use createDesignWorkflow.runAsStep() for proper workflow composition
      return createDesignWorkflow.runAsStep({
        input: createDesignInput,
      });
    });

    // Return response using transform for runtime value access
    // Always return the uploaded media URL instead of the base64 image_url
    const response = transform(
      { input, mastraResult, uploadResult, createDesignResult },
      (data) => ({
        mode: data.input.mode,
        // Always use the uploaded media URL if available
        preview_url: data.uploadResult?.media_url || data.mastraResult.image_url,
        media_id: data.uploadResult?.media_id,
        // createDesignWorkflow returns the design object directly with an id property
        design_id: data.createDesignResult?.id,
        prompt_used: data.mastraResult.prompt_used,
        badges: data.input.badges,
        materials_prompt: data.input.materials_prompt,
        generated_at: new Date().toISOString(),
        quota_remaining: data.mastraResult.quota_remaining,
      })
    );

    return new WorkflowResponse(response);
  }
);
