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
import { DESIGN_MODULE } from "../../modules/designs";
import DesignService from "../../modules/designs/service";

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
      const run = await workflow.createRunAsync();
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
};

const uploadGeneratedImageStep = createStep(
  "upload-generated-image-step",
  async (input: UploadImageInput, { container }): Promise<StepResponse<UploadResult, string>> => {
    // Fetch the image from the URL
    const response = await fetch(input.image_url);

    if (!response.ok) {
      throw new Error(`Failed to fetch generated image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentString = buffer.toString("binary");

    // Determine filename and mime type
    const timestamp = Date.now();
    const filename = `ai-design-${input.customer_id}-${timestamp}.png`;
    const mimeType = response.headers.get("content-type") || "image/png";

    // Upload using the existing media workflow
    const { result: mediaResult } = await uploadAndOrganizeMediaWorkflow(container).run({
      input: {
        files: [{
          filename,
          mimeType,
          content: contentString,
        }],
        folder: {
          name: `ai-designs`,
          description: "AI-generated design images",
          parent_folder_id: undefined,
        },
        metadata: {
          badges: input.badges || {},
          materials_prompt: input.materials_prompt || "",
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

// Main workflow
export const generateDesignAiImageWorkflow = createWorkflow(
  "generate-design-ai-image",
  (input: GenerateDesignAiImageInput) => {
    // Step 1: Generate image via Mastra
    const mastraResult = invokeMastraImageGenStep(input);

    // Step 2: If commit mode, upload to media storage
    // Use transform to prepare input from step results
    const uploadInput = transform(
      { input, mastraResult },
      (data) => ({
        image_url: data.mastraResult.image_url || "",
        customer_id: data.input.customer_id,
        badges: data.input.badges,
        materials_prompt: data.input.materials_prompt,
      })
    );

    const uploadResult = when(
      "upload-if-commit",
      { input, mastraResult },
      (data) => data.input.mode === "commit" && !!data.mastraResult.image_url
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

    // Return response using transform for runtime value access
    const response = transform(
      { input, mastraResult, uploadResult },
      (data) => ({
        mode: data.input.mode,
        preview_url: data.input.mode === "preview"
          ? data.mastraResult.image_url
          : data.uploadResult?.media_url,
        media_id: data.input.mode === "commit" ? data.uploadResult?.media_id : undefined,
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
