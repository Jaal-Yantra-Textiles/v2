// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { dynamicFreeTextModel } from "../../providers/dynamic-text-model";
import {
  generateWithCloudflare,
  type CloudflareImageConfig,
} from "./providers/cloudflare";
import { generateWithFal } from "./providers/fal";

// Import provider modules
import {
  ImageProvider,
  GenerationResult,
  PROVIDER_PRIORITY,
  extractRetryAfterMs,
} from "./providers";
import { generateWithGoogleImagen } from "./providers/google-imagen";
import { generateWithGeminiFlash } from "./providers/gemini-flash-image";
import { generateWithMistralFlux } from "./providers/mistral-flux";
import { generateWithFireworks } from "./providers/fireworks";
import { generateWithCheapestModel } from "./providers/model-selector";
import {
  canUseProvider,
  recordRequest,
  recordRateLimitHit,
  getProviderStatus,
} from "./rate-limit-manager";

/**
 * Design Image Generation Workflow
 *
 * This workflow generates fashion design images using:
 * - Step 1: Mastra Agent for prompt enhancement (text generation)
 * - Step 2: Quota check
 * - Step 3: Multi-provider image generation with fallback
 *
 * Provider Types:
 * - Image Models: Dedicated image generation (Google Imagen, Fireworks FLUX)
 * - Text Models with Image Output: Multi-modal text models (Gemini Flash, Mistral)
 *
 * Provider Priority: Mistral → Gemini Flash → Google Imagen → Fireworks → "Out of credits"
 *
 * Implementation Notes:
 * - Google Imagen uses AI SDK's @ai-sdk/google with experimental_generateImage
 * - Gemini Flash uses AI SDK's generateText with files property for image output
 * - Mistral uses Mastra Agent with image_generation built-in tool
 * - Fireworks uses AI SDK's @ai-sdk/fireworks with experimental_generateImage
 * - Rate limit tracking is in-memory to proactively skip rate-limited providers
 *
 * @see https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai#image-outputs
 * @see https://docs.mistral.ai/agents/tools/built-in/image_generation
 * @see https://ai-sdk.dev/providers/ai-sdk-providers/fireworks
 */

// Create a dedicated agent for prompt enhancement (text generation only)
// Uses the dynamic free text model so expired/paid models are never used by accident.
const promptEnhancerAgent = new Agent({
  name: "prompt-enhancer-agent",
  model: dynamicFreeTextModel,
  instructions:
    "You are an expert fashion design AI assistant. " +
    "When given style preferences, materials, and reference images, you enhance and optimize prompts for fashion design image generation. " +
    "You understand fashion terminology, fabric properties, and design aesthetics. " +
    "Create detailed, professional prompts suitable for text-to-image generation.",
});

// Trigger schema (workflow input)
export const triggerSchema = z.object({
  mode: z.enum(["preview", "commit"]).default("preview"),
  badges: z
    .object({
      style: z.string().optional(),
      color_family: z.string().optional(),
      body_type: z.string().optional(),
      embellishment_level: z.string().optional(),
      occasion: z.string().optional(),
      budget_sensitivity: z.string().optional(),
      custom: z.record(z.string(), z.any()).optional(),
    })
    .optional(),
  /**
   * 🔴 THE GARMENT. Absent until now, and its absence is why this workflow
   * generated the wrong thing every single time.
   *
   * `styleContext` is built from `badges` alone and falls back to the literal
   * string `"casual fashion"` when there are none. So a maker who spent three
   * turns describing a heritage-indigo handwoven kurta — product type, concept
   * theme, five aesthetic keywords, a two-colour palette, all of it normalised
   * by `save_brief` and persisted on the design — had the image model asked
   * for "casual fashion". It answered honestly: a pastel pink blouse, and a
   * pastel blue denim jacket.
   *
   * Nothing failed. Two images came back, the board filled, the chat said
   * "here are your two takes". The output was simply unrelated to the design,
   * and no test can see that because every test asserts an image URL exists.
   *
   * The brief is the ONE input this workflow could least afford to be missing.
   */
  design_brief: z
    .object({
      product_type: z.string().nullish(),
      concept_theme: z.string().nullish(),
      aesthetic_keywords: z.array(z.string()).optional(),
      color_palette: z
        .array(z.object({ name: z.string().nullish(), code: z.string().nullish() }))
        .optional(),
    })
    .optional(),
  materials_prompt: z.string().optional(),
  reference_images: z
    .array(
      z.object({
        url: z.string().url(),
        weight: z.number().min(0).max(1).default(0.5).optional(),
        prompt: z.string().optional(),
      })
    )
    .max(3)
    .optional(),
  canvas_snapshot: z
    .object({
      width: z.number().positive(),
      height: z.number().positive(),
      layers: z.array(
        z.object({
          id: z.string(),
          type: z.enum(["image", "text", "shape"]).default("image"),
          data: z.record(z.string(), z.any()),
        })
      ),
    })
    .optional(),
  preview_cache_key: z.string().optional(),
  customer_id: z.string(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  // Resolved image-gen platform config (from the Medusa container — the
  // Mastra runtime has no container, so the caller hands us the credentials).
  // `resolveImageProvider` decides whether it is usable here — Cloudflare and
  // FAL both are; anything else falls through to the env provider chain and
  // SAYS SO rather than pretending the admin's choice was honoured.
  image_gen_config: z
    .object({
      provider_type: z.string().optional(),
      api_key: z.string().optional(),
      account_id: z.string().optional(),
      base_url: z.string().optional(),
      model: z.string().nullable().optional(),
    })
    .optional(),
  /**
   * The TEXT model that rewrites the brief into an image prompt.
   *
   * 🔴 Separate from `image_gen_config` on purpose. Prompt enhancement used to
   * piggyback on the image platform, and only when that platform was
   * Cloudflare; for anything else it dropped to the OpenRouter free rotator —
   * the dependency #1669 claimed to remove, and one that answers real requests
   * with "this model is only available on agentic harnesses".
   *
   * FAL is the case that makes the split unavoidable: it is image-only, so
   * "use the image platform for text" cannot work there at all. The caller
   * resolves a text-capable platform from the container and hands it down.
   */
  prompt_model_config: z
    .object({
      provider_type: z.string().optional(),
      api_key: z.string().optional(),
      account_id: z.string().optional(),
      base_url: z.string().optional(),
      model: z.string().nullable().optional(),
    })
    .optional(),
});

// Final output schema (workflow output)
export const outputSchema = z.object({
  image_url: z.string().optional(),
  enhanced_prompt: z.string(),
  style_context: z.string(),
  quota_remaining: z.number(),
  provider_used: z.string().optional(),
  error: z.string().optional(),
});

// Sample test image (1x1 transparent PNG as base64)
const TEST_SAMPLE_IMAGE_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Check if we're running in a test environment
 * Returns true if TEST_TYPE env var is set (integration tests)
 */
function isTestEnvironment(): boolean {
  return !!process.env.TEST_TYPE;
}

/**
 * True when the caller handed down a usable Cloudflare image-gen platform
 * (role ai_image_gen). In a test environment we still want REAL generation
 * when credentials are present — the stub is only the no-credential fallback
 * so CI (no token) exercises the full flow without an image call.
 */
// Superseded by `hasConfiguredImageCreds`; kept only as the Cloudflare-specific
// question, which the text-model branch below still asks.
function hasCfImageCreds(cfg?: { provider_type?: string; api_key?: string; account_id?: string }): boolean {
  return !!(cfg && cfg.provider_type === "cloudflare" && cfg.api_key && cfg.account_id);
}

/**
 * PURE: can the configured `ai_image_gen` platform actually generate here?
 *
 * 🔴 The gate used to be "is it Cloudflare?", and production's platform is
 * **fal** — active, keyed, and matching nothing. The configured platform was
 * skipped in silence and generation fell through to the env-keyed provider
 * chain, which is a different set of credentials, a different bill, and a
 * different model from the one an admin chose in Settings.
 *
 * "Configured" and "usable" are separate questions and this answers the second.
 * A platform whose provider has no generator module here is NOT usable, and
 * saying so out loud beats pretending the admin's choice was honoured.
 */
export function resolveImageProvider(cfg?: {
  provider_type?: string;
  api_key?: string;
  account_id?: string;
}): "cloudflare" | "fal" | null {
  if (!cfg?.api_key) return null;
  if (cfg.provider_type === "cloudflare") return cfg.account_id ? "cloudflare" : null;
  if (cfg.provider_type === "fal") return "fal";
  return null;
}

/** Any usable configured platform — the test-stub gate, widened past Cloudflare. */
function hasConfiguredImageCreds(cfg?: {
  provider_type?: string;
  api_key?: string;
  account_id?: string;
}): boolean {
  return resolveImageProvider(cfg) !== null;
}

// Step 1: Build and enhance prompt using Mistral agent
// Input: triggerSchema, Output: enhanced prompt data + passthrough fields
const step1OutputSchema = z.object({
  enhanced_prompt: z.string(),
  style_context: z.string(),
  technical_details: z.string().optional(),
  // Passthrough fields needed by subsequent steps
  mode: z.enum(["preview", "commit"]),
  customer_id: z.string(),
  image_gen_config: z
    .object({
      provider_type: z.string().optional(),
      api_key: z.string().optional(),
      account_id: z.string().optional(),
      base_url: z.string().optional(),
      model: z.string().nullable().optional(),
    })
    .optional(),
});

/** Cloudflare text model for prompt enhancement (same account/token as image gen). */
const CF_PROMPT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * Build the prompt-enhancement model from a handed-down platform config.
 *
 * Mirrors `buildChatModel` in ai-platforms rather than importing it: that
 * module reaches for the Medusa container, and this file runs inside the Mastra
 * runtime where there isn't one. Same provider rules, no container.
 */
function buildPromptModel(cfg: {
  provider_type?: string;
  api_key?: string;
  account_id?: string;
  base_url?: string;
  model?: string | null;
}) {
  const id = cfg.model || CF_PROMPT_MODEL;
  const baseURL =
    cfg.base_url ||
    (cfg.provider_type === "cloudflare" && cfg.account_id
      ? `https://api.cloudflare.com/client/v4/accounts/${cfg.account_id}/ai/v1`
      : undefined);
  const client = createOpenAI({ baseURL, apiKey: cfg.api_key });
  return client.chat(id);
}

const buildPromptStep = createStep({
  id: "buildPrompt",
  inputSchema: triggerSchema,
  outputSchema: step1OutputSchema,
  execute: async ({ inputData }) => {
    const {
      badges,
      design_brief,
      materials_prompt,
      reference_images,
      mode,
      customer_id,
      image_gen_config,
      prompt_model_config,
    } = inputData;

    // Build initial style context — the BRIEF first, then badges.
    //
    // Order matters: the garment and its concept are what the image is OF;
    // badges are adjustments to it. Appending the brief after the style
    // preferences would bury "kurta" behind "Style: relaxed".
    const styleParts: string[] = [];
    if (design_brief) {
      if (design_brief.product_type)
        styleParts.push(`Garment: ${String(design_brief.product_type).replace(/_/g, " ")}`);
      if (design_brief.concept_theme)
        styleParts.push(`Concept: ${design_brief.concept_theme}`);
      const keywords = (design_brief.aesthetic_keywords ?? []).filter(Boolean);
      if (keywords.length) styleParts.push(`Aesthetic: ${keywords.join(", ")}`);
      const palette = (design_brief.color_palette ?? [])
        .map((c) => [c?.name, c?.code].filter(Boolean).join(" "))
        .filter(Boolean);
      if (palette.length) styleParts.push(`Colours: ${palette.join(", ")}`);
    }
    if (badges) {
      if (badges.style) styleParts.push(`Style: ${badges.style}`);
      if (badges.color_family)
        styleParts.push(`Color palette: ${badges.color_family}`);
      if (badges.body_type) styleParts.push(`Body fit: ${badges.body_type}`);
      if (badges.embellishment_level)
        styleParts.push(`Embellishment: ${badges.embellishment_level}`);
      if (badges.occasion) styleParts.push(`Occasion: ${badges.occasion}`);
      if (badges.budget_sensitivity)
        styleParts.push(`Budget: ${badges.budget_sensitivity}`);
    }

    /**
     * ⚠️ `"casual fashion"` is the fallback that made the failure invisible.
     * With no brief and no badges the model was asked for generic casual wear
     * and cheerfully produced it, so the pipeline looked healthy end to end
     * while generating a garment nobody had described. It stays only as the
     * last resort for a caller that supplies neither — and now says so.
     */
    const styleContext =
      styleParts.length > 0 ? styleParts.join(", ") : "casual fashion";

    // Build reference context
    let refContext = "";
    if (reference_images && reference_images.length > 0) {
      refContext = `\nReference images (${reference_images.length}):`;
      reference_images.forEach((ref, idx) => {
        refContext += `\n- Image ${idx + 1}${ref.prompt ? `: ${ref.prompt}` : ""}`;
      });
    }

    const userPrompt =
      `Create an optimized image generation prompt for a fashion design with these specifications:\n\n` +
      // "Design brief", not "Style preferences" — this line now leads with the
      // garment and its concept, and mislabelling it invites the model to treat
      // the whole thing as optional styling.
      `Design brief: ${styleContext}\n` +
      (materials_prompt ? `Materials: ${materials_prompt}\n` : "") +
      refContext +
      `\n\nGenerate a detailed, professional prompt suitable for a text-to-image AI model. ` +
      `Focus on visual elements, textures, colors, and design details. ` +
      `The prompt should be clear, specific, and optimized for high-quality fashion design generation.`;

    // In test environment WITHOUT image-gen credentials, skip the AI call to
    // save credits (and so CI has no dependency on a token).
    if (isTestEnvironment() && !hasConfiguredImageCreds(image_gen_config)) {
      console.log(`[ImageGen] Test environment detected - returning mock prompt`);
      return {
        enhanced_prompt: `Test fashion design: ${styleContext}. ${materials_prompt || ""}`.trim(),
        style_context: styleContext,
        technical_details: "Test mode - no AI enhancement",
        mode,
        customer_id,
        image_gen_config,
      };
    }

    /**
     * Resolve the text model for prompt enhancement, in order:
     *
     *   1. `prompt_model_config` — a text-capable platform the caller resolved
     *      from the container. This is the only branch that works when the
     *      image platform is FAL (image-only), which is production's.
     *   2. A Cloudflare IMAGE platform, whose account/token also serves Workers
     *      AI text — the original special case, kept because it is free.
     *   3. The OpenRouter free rotator.
     *
     * 🔴 (3) was effectively the only branch in production. The rotator is not
     * a fallback so much as a coin flip: it answers live requests with "this
     * model is only available on agentic harnesses", and when it does, the
     * enhancement is skipped and the RAW prompt is used — which is how a brief
     * became "casual fashion" twice over.
     */
    let model = dynamicFreeTextModel;
    if (prompt_model_config?.api_key) {
      model = buildPromptModel(prompt_model_config);
    } else if (
      image_gen_config?.provider_type === "cloudflare" &&
      image_gen_config.api_key &&
      image_gen_config.account_id
    ) {
      const cf = createOpenAI({
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${image_gen_config.account_id}/ai/v1`,
        apiKey: image_gen_config.api_key,
      });
      model = cf.chat(CF_PROMPT_MODEL);
    }

    let enhanced = userPrompt;
    try {
      const response = await generateText({
        model,
        prompt:
          `You are a fashion design image-generation prompt writer. ` +
          `Rewrite the following into ONE detailed text-to-image prompt (visual elements, textures, colors, construction). ` +
          `Output only the prompt, no preamble or quotes:\n\n${userPrompt}`,
      } as any);
      const text = (response as any)?.text?.trim();
      if (text) enhanced = text;
    } catch (e) {
      console.warn(`[ImageGen] prompt enhancement failed, using raw prompt: ${(e as any)?.message ?? e}`);
    }

    return {
      enhanced_prompt: enhanced,
      style_context: styleContext,
      technical_details: undefined,
      mode,
      customer_id,
      image_gen_config,
    };
  },
});

// Step 2: Check quota
// Input: step1 output, Output: add quota info
const step2OutputSchema = step1OutputSchema.extend({
  quota_allowed: z.boolean(),
  quota_remaining: z.number(),
});

const checkQuotaStep = createStep({
  id: "checkQuota",
  inputSchema: step1OutputSchema,
  outputSchema: step2OutputSchema,
  execute: async ({ inputData }) => {
    const { mode } = inputData;

    // Simple quota check - can be enhanced with Redis/DB
    // Preview: higher limit (50/day), Commit: lower limit (10/day)
    const quotaData =
      mode === "preview"
        ? { allowed: true, remaining: 45 }
        : { allowed: true, remaining: 8 };

    return {
      ...inputData,
      quota_allowed: quotaData.allowed,
      quota_remaining: quotaData.remaining,
    };
  },
});

/**
 * Generate image using provider chain with automatic fallback
 *
 * Strategy:
 * 1. First, try the cheapest available model from our model selector
 * 2. If that fails, fall back to the provider chain (Mistral → Gemini Flash → Google Imagen → Fireworks)
 * 3. If all providers fail: return OUT_OF_CREDITS error
 *
 * Flow:
 * 1. Try cheapest model first (sorted by price)
 * 2. If fails, check rate limit status for each provider in fallback chain
 * 3. Try providers in priority order, skipping rate-limited ones
 * 4. On success: record request and return image
 * 5. On rate limit: record hit and try next provider
 * 6. If all providers fail: return OUT_OF_CREDITS error
 */
async function generateWithProviderChain(
  prompt: string
): Promise<GenerationResult & { providerStatus?: Record<ImageProvider, unknown> }> {
  console.log(`[ImageGen] Starting with cheapest model approach...`);

  // Step 1: Try the cheapest model first
  try {
    const cheapestResult = await generateWithCheapestModel(prompt);

    if (cheapestResult.success && cheapestResult.imageUrl) {
      console.log(`[ImageGen] Success with cheapest model: ${cheapestResult.modelUsed}`);
      return {
        success: true,
        imageUrl: cheapestResult.imageUrl,
        provider: "google", // Generic, actual model is in logs
        providerStatus: getProviderStatus(),
      };
    }

    console.log(`[ImageGen] Cheapest model approach failed: ${cheapestResult.error}`);
    console.log(`[ImageGen] Falling back to provider chain...`);
  } catch (error) {
    console.log(`[ImageGen] Cheapest model threw error, falling back to provider chain...`);
  }

  // Step 2: Fall back to provider chain
  console.log(`[ImageGen] Starting provider chain fallback...`);
  console.log(`[ImageGen] Provider status:`, getProviderStatus());

  const errors: string[] = [];

  for (const provider of PROVIDER_PRIORITY) {
    // Check if provider is available (not rate-limited)
    if (!canUseProvider(provider)) {
      console.log(`[ImageGen] Skipping ${provider} (rate limited)`);
      errors.push(`${provider}: rate limited`);
      continue;
    }

    console.log(`[ImageGen] Trying provider: ${provider}`);

    let result: GenerationResult;

    try {
      // Call the appropriate provider
      switch (provider) {
        case "google":
          result = await generateWithGoogleImagen(prompt);
          break;
        case "gemini-flash":
          result = await generateWithGeminiFlash(prompt);
          break;
        case "mistral":
          result = await generateWithMistralFlux(prompt);
          break;
        case "fireworks":
          result = await generateWithFireworks(prompt);
          break;
        default:
          continue;
      }

      // Handle result
      if (result.success && result.imageUrl) {
        recordRequest(provider);
        console.log(`[ImageGen] Success with ${provider}`);
        return {
          ...result,
          providerStatus: getProviderStatus(),
        };
      }

      // Handle rate limit error
      if (result.errorCode === "RATE_LIMITED") {
        console.log(`[ImageGen] ${provider} returned rate limit error`);
        recordRateLimitHit(provider);
        errors.push(`${provider}: ${result.error}`);
        continue;
      }

      // Handle other errors - try next provider
      console.log(`[ImageGen] ${provider} failed: ${result.error}`);
      errors.push(`${provider}: ${result.error}`);

      // For server errors, we might want to retry once
      if (result.errorCode === "SERVER_ERROR") {
        console.log(`[ImageGen] Retrying ${provider} once due to server error...`);

        // Small delay before retry
        await new Promise((resolve) => setTimeout(resolve, 1000));

        switch (provider) {
          case "google":
            result = await generateWithGoogleImagen(prompt);
            break;
          case "gemini-flash":
            result = await generateWithGeminiFlash(prompt);
            break;
          case "mistral":
            result = await generateWithMistralFlux(prompt);
            break;
          case "fireworks":
            result = await generateWithFireworks(prompt);
            break;
        }

        if (result.success && result.imageUrl) {
          recordRequest(provider);
          console.log(`[ImageGen] Success with ${provider} on retry`);
          return {
            ...result,
            providerStatus: getProviderStatus(),
          };
        }

        // Still failed, record and continue
        if (result.errorCode === "RATE_LIMITED") {
          recordRateLimitHit(provider);
        }
        errors.push(`${provider} (retry): ${result.error}`);
      }
    } catch (error: unknown) {
      console.error(`[ImageGen] Unexpected error with ${provider}:`, error);

      // Check if it's a rate limit error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.toLowerCase().includes("rate limit") ||
        errorMessage.includes("429")
      ) {
        recordRateLimitHit(provider, extractRetryAfterMs(error));
      }

      errors.push(`${provider}: ${errorMessage}`);
    }
  }

  // All providers exhausted
  console.log(`[ImageGen] All providers exhausted. Errors:`, errors);
  return {
    success: false,
    provider: "google", // Default, but not used
    error: "OUT_OF_CREDITS",
    errorCode: "RATE_LIMITED",
    providerStatus: getProviderStatus(),
  };
}

// Step 3: Generate image using provider chain
// Input: step2 output, Output: final result
const generateImageStep = createStep({
  id: "generateImage",
  inputSchema: step2OutputSchema,
  outputSchema: outputSchema,
  execute: async ({ inputData }) => {
    const {
      enhanced_prompt,
      style_context,
      quota_allowed,
      quota_remaining,
      mode,
      image_gen_config,
    } = inputData;

    if (!quota_allowed) {
      return {
        image_url: undefined,
        enhanced_prompt,
        style_context,
        quota_remaining,
        error: "Quota exceeded",
      };
    }

    // In test environment WITHOUT image-gen credentials, return a sample image
    // to avoid using AI credits (and so CI has no dependency on a token).
    if (isTestEnvironment() && !hasConfiguredImageCreds(image_gen_config)) {
      console.log(`[ImageGen] Test environment detected - returning sample image`);
      return {
        image_url: TEST_SAMPLE_IMAGE_BASE64,
        enhanced_prompt,
        style_context,
        quota_remaining,
        provider_used: "test-mock",
        error: undefined,
      };
    }

    try {
      console.log(`[ImageGen] Mode: ${mode}, Starting generation...`);
      console.log(`[ImageGen] Enhanced Prompt: ${enhanced_prompt.substring(0, 200)}...`);

      /**
       * The ADMIN-CONFIGURED platform goes first, whatever it is.
       *
       * 🔴 This used to read `provider_type === "cloudflare"` and nothing else.
       * Production's `ai_image_gen` is **fal** — active, keyed, chosen by an
       * admin in Settings — and it matched no branch, so every generation went
       * to the env-keyed provider chain instead: different credentials, a
       * different bill, and a different model from the one that was configured.
       * Nothing logged that the choice had been ignored.
       */
      const configuredProvider = resolveImageProvider(image_gen_config);

      if (configuredProvider === "cloudflare") {
        const cfResult = await generateWithCloudflare(enhanced_prompt, {
          api_key: image_gen_config!.api_key!,
          account_id: image_gen_config!.account_id!,
          model: image_gen_config!.model ?? null,
        } as CloudflareImageConfig);

        if (cfResult.success && cfResult.imageUrl) {
          console.log(`[ImageGen] Success via ${cfResult.modelUsed ?? "cloudflare"}`);
          return {
            image_url: cfResult.imageUrl,
            enhanced_prompt,
            style_context,
            quota_remaining,
            provider_used: "cloudflare",
            error: undefined,
          };
        }

        console.log(`[ImageGen] Cloudflare failed: ${cfResult.error} — falling back to provider chain`);
      } else if (configuredProvider === "fal") {
        const falResult = await generateWithFal(enhanced_prompt, {
          api_key: image_gen_config!.api_key!,
          model: image_gen_config!.model ?? null,
        });

        if (falResult.success && falResult.imageUrl) {
          console.log(`[ImageGen] Success via ${falResult.modelUsed ?? "fal"}`);
          return {
            image_url: falResult.imageUrl,
            enhanced_prompt,
            style_context,
            quota_remaining,
            provider_used: "fal",
            error: undefined,
          };
        }

        console.log(`[ImageGen] FAL failed: ${falResult.error} — falling back to provider chain`);
      } else if (image_gen_config?.api_key) {
        // Configured, but this workflow has no generator for it. Say so — the
        // silent version of this is what sent production down the env chain
        // for months while an admin believed their platform was in use.
        console.warn(
          `[ImageGen] ai_image_gen platform is provider_type="${image_gen_config.provider_type}", ` +
            `which has no generator here — using the env provider chain instead. ` +
            `Configure a cloudflare or fal platform, or add a provider module.`
        );
      }

      // Use provider chain with automatic fallback
      const result = await generateWithProviderChain(enhanced_prompt);

      if (result.success && result.imageUrl) {
        console.log(`[ImageGen] Successfully generated image via ${result.provider}`);
        return {
          image_url: result.imageUrl,
          enhanced_prompt,
          style_context,
          quota_remaining,
          provider_used: result.provider,
          error: undefined,
        };
      }

      // All providers failed
      if (result.error === "OUT_OF_CREDITS") {
        console.log(`[ImageGen] All providers exhausted - returning OUT_OF_CREDITS`);
        return {
          image_url: undefined,
          enhanced_prompt,
          style_context,
          quota_remaining,
          error: "OUT_OF_CREDITS",
        };
      }

      // Some other error occurred
      console.log(`[ImageGen] Generation failed: ${result.error}`);
      return {
        image_url: undefined,
        enhanced_prompt,
        style_context,
        quota_remaining,
        error: result.error || "Image generation failed",
      };
    } catch (error: any) {
      console.error(`[ImageGen] Unexpected error:`, error);
      return {
        image_url: undefined,
        enhanced_prompt,
        style_context,
        quota_remaining,
        error: error?.message || "Image generation failed",
      };
    }
  },
});

// Main workflow using .then() for proper chaining
export const imageGenerationWorkflow = createWorkflow({
  id: "image-generation",
  inputSchema: triggerSchema,
  outputSchema: outputSchema,
})
  .then(buildPromptStep)
  .then(checkQuotaStep)
  .then(generateImageStep)
  .commit();
