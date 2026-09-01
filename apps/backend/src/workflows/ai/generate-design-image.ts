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
import { getAiPlatformForRole } from "../../mastra/services/ai-platforms";

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
  /**
   * The normalised brief — the garment itself.
   *
   * 🔴 Without it the prompt enhancer builds its style context from `badges`
   * alone and falls back to the literal string "casual fashion", so the image
   * is of a garment nobody described. See `design_brief` on the mastra trigger
   * schema for what that looked like in practice.
   */
  design_brief?: {
    product_type?: string | null;
    concept_theme?: string | null;
    aesthetic_keywords?: string[];
    color_palette?: Array<{ name?: string | null; code?: string | null }>;
  };
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
  async (input: GenerateDesignAiImageInput, { container }): Promise<StepResponse<MastraImageGenResult, { imageUrl?: string; mode: string }>> => {
    try {
      const workflow = mastra.getWorkflow("imageGenerationWorkflow");

      if (!workflow) {
        throw new Error("Image generation workflow not found in Mastra");
      }

      // Resolve the image-gen provider: admin-configured External Platform
      // (ai_image_gen) first, then the Cloudflare env fallback. The Mastra
      // runtime has no Medusa container, so we hand the credentials down.
      let image_gen_config: any = null;
      try {
        const platform = await getAiPlatformForRole(container as any, "ai_image_gen");
        if (platform) {
          image_gen_config = {
            provider_type: platform.providerType,
            api_key: platform.apiKey,
            account_id: platform.accountId,
            base_url: platform.baseUrl,
            model: platform.defaultModel,
          };
        }
      } catch (e: any) {
        console.warn(`[ai-imagegen] platform resolution failed: ${e?.message ?? e}`);
      }

      if (
        !image_gen_config &&
        process.env.CLOUDFLARE_AI_TOKEN &&
        process.env.CLOUDFLARE_AI_ACCOUNT_ID
      ) {
        image_gen_config = {
          provider_type: "cloudflare",
          api_key: process.env.CLOUDFLARE_AI_TOKEN,
          account_id: process.env.CLOUDFLARE_AI_ACCOUNT_ID,
          model: null,
        };
      }

      /**
       * The TEXT model that turns the brief into an image prompt.
       *
       * 🔴 Resolved separately from the image platform, because the image
       * platform may not do text at all. Production's is **fal** — image-only —
       * and the workflow's only text branch was "is the image platform
       * Cloudflare?". It wasn't, so enhancement fell to the OpenRouter free
       * rotator, which answers live requests with "only available on agentic
       * harnesses". When it fails the RAW prompt is used, so a brief quietly
       * becomes whatever the raw string happened to say.
       *
       * An image platform that CAN do text is still preferred — same key, same
       * bill. Otherwise borrow a text role that is already configured.
       */
      let prompt_model_config: any = null;
      if (image_gen_config && image_gen_config.provider_type !== "fal") {
        prompt_model_config = image_gen_config;
      } else {
        for (const role of ["ai_design_product_type", "ai_search_chat"] as const) {
          try {
            const textPlatform = await getAiPlatformForRole(container as any, role);
            if (textPlatform?.apiKey) {
              prompt_model_config = {
                provider_type: textPlatform.providerType,
                api_key: textPlatform.apiKey,
                account_id: textPlatform.accountId,
                base_url: textPlatform.baseUrl,
                model: textPlatform.defaultModel,
              };
              break;
            }
          } catch {
            // Try the next role; the workflow's own fallback covers "none".
          }
        }
      }

      // Create run and start workflow
      const run = await workflow.createRun();
      const result = await run.start({
        inputData: {
          mode: input.mode,
          badges: input.badges,
          // The garment. Everything else here is an adjustment TO it.
          design_brief: input.design_brief,
          materials_prompt: input.materials_prompt,
          reference_images: input.reference_images,
          canvas_snapshot: input.canvas_snapshot,
          preview_cache_key: input.preview_cache_key,
          customer_id: input.customer_id,
          image_gen_config,
          prompt_model_config,
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

/**
 * Should this generation be filed as its own design record? (#1721)
 *
 * Exported and pure so the rule can be asserted directly. It used to be the
 * word "Always" in a comment, and that is precisely why one design-chat session
 * produced three designs on production: the real one, plus a row per generated
 * image named `AI Design - <timestamp>`.
 *
 * Two conditions, and they mean different things:
 *
 *  - `uploadResult.media_id` — there is an actual stored image to file. No
 *    image, no record; a failed generation should leave nothing behind.
 *  - NO `design_id` on the input — nobody has already given this picture a
 *    home. When the caller names a design, the workflow's commit step attaches
 *    the image to it, and a second record for the same picture is a duplicate
 *    that no list can tell apart from a real design.
 *
 * ⚠️ An EMPTY-STRING design_id counts as "no design", deliberately: the commit
 * step gates on `!!design_id` too, so with `""` nothing attaches the image and
 * the history record is the only trace it would leave.
 */
export const shouldCreateHistoryDesign = (data: {
  input: { design_id?: string | null }
  uploadResult?: { media_id?: string | null } | null
}): boolean => !!data.uploadResult?.media_id && !data.input.design_id

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

    // Step 4: Save the generation as its own design — ONLY when it has no home
    // Uses createDesignWorkflow.runAsStep() for proper workflow composition
    //
    // 🔴 This used to run unconditionally, and the comment said so ("Always
    // create a design entry"). When the caller already supplied a `design_id`,
    // Step 3 above attached the image to that design and Step 4 then minted a
    // SECOND record for the same picture — one per image. A design chat asking
    // for two takes produced three designs: the real one plus two rows named
    // `AI Design - <timestamp>` (#1721, seen on production 2026-09-01).
    //
    // The history intent is right for a standalone generation, which otherwise
    // leaves no trace a customer can find later. It is wrong the moment a
    // design_id is given: the history already has a home, and the duplicate is
    // indistinguishable from a real design in every list.
    //
    // ⚠️ #1698 made the chat's `create_design` TOOL idempotent per thread. This
    // path is a second creator that fix never touched — enumerate every creator
    // before calling a duplicate-record bug closed.
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
      { input, uploadResult },
      (data) => shouldCreateHistoryDesign(data)
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
        // createDesignWorkflow returns the design object directly with an id
        // property. ⚠️ Falls back to the design the caller named: Step 4 no
        // longer runs when one was supplied (#1721), and a response that
        // dropped `design_id` in that case would look like "no design" to every
        // caller that reads it — the duplicate would be gone and the answer
        // would be wrong in a new way.
        design_id: data.createDesignResult?.id || data.input.design_id,
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
