// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod/v4";
import { Agent } from "@mastra/core/agent";
import { mistral } from "@ai-sdk/mistral";

// Create a dedicated agent for design image generation
const designImageAgent = new Agent({
  name: "design-image-agent",
  model: mistral("pixtral-large-latest"),
  instructions:
    "You are an expert fashion design AI assistant. " +
    "When given style preferences, materials, and reference images, you enhance and optimize prompts for fashion design image generation. " +
    "You understand fashion terminology, fabric properties, and design aesthetics. " +
    "Create detailed, professional prompts suitable for text-to-image generation.",
});

// Trigger schema (workflow input)
export const triggerSchema = z.object({
  mode: z.enum(["preview", "commit"]).default("preview"),
  badges: z.object({
    style: z.string().optional(),
    color_family: z.string().optional(),
    body_type: z.string().optional(),
    embellishment_level: z.string().optional(),
    occasion: z.string().optional(),
    budget_sensitivity: z.string().optional(),
    custom: z.record(z.string(), z.any()).optional(),
  }).optional(),
  materials_prompt: z.string().optional(),
  reference_images: z.array(z.object({
    url: z.string().url(),
    weight: z.number().min(0).max(1).default(0.5).optional(),
    prompt: z.string().optional(),
  })).max(3).optional(),
  canvas_snapshot: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    layers: z.array(z.object({
      id: z.string(),
      type: z.enum(["image", "text", "shape"]).default("image"),
      data: z.record(z.any()),
    })),
  }).optional(),
  preview_cache_key: z.string().optional(),
  customer_id: z.string(),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
});

// Final output schema (workflow output)
export const outputSchema = z.object({
  image_url: z.string().optional(),
  enhanced_prompt: z.string(),
  style_context: z.string(),
  quota_remaining: z.number(),
  error: z.string().optional(),
});

// Step 1: Build and enhance prompt using Mistral agent
// Input: triggerSchema, Output: enhanced prompt data + passthrough fields
const step1OutputSchema = z.object({
  enhanced_prompt: z.string(),
  style_context: z.string(),
  technical_details: z.string().optional(),
  // Passthrough fields needed by subsequent steps
  mode: z.enum(["preview", "commit"]),
  customer_id: z.string(),
});

const buildPromptStep = createStep({
  id: "buildPrompt",
  inputSchema: triggerSchema,
  outputSchema: step1OutputSchema,
  execute: async ({ inputData }) => {
    const { badges, materials_prompt, reference_images, threadId, resourceId, mode, customer_id } = inputData;

    // Build initial style context from badges
    const styleParts: string[] = [];
    if (badges) {
      if (badges.style) styleParts.push(`Style: ${badges.style}`);
      if (badges.color_family) styleParts.push(`Color palette: ${badges.color_family}`);
      if (badges.body_type) styleParts.push(`Body fit: ${badges.body_type}`);
      if (badges.embellishment_level) styleParts.push(`Embellishment: ${badges.embellishment_level}`);
      if (badges.occasion) styleParts.push(`Occasion: ${badges.occasion}`);
      if (badges.budget_sensitivity) styleParts.push(`Budget: ${badges.budget_sensitivity}`);
    }

    const styleContext = styleParts.length > 0 ? styleParts.join(", ") : "casual fashion";

    // Build reference context
    let refContext = "";
    if (reference_images && reference_images.length > 0) {
      refContext = `\nReference images (${reference_images.length}):`;
      reference_images.forEach((ref, idx) => {
        refContext += `\n- Image ${idx + 1}${ref.prompt ? `: ${ref.prompt}` : ''}`;
      });
    }

    // Use the agent to enhance the prompt
    const userPrompt =
      `Create an optimized image generation prompt for a fashion design with these specifications:\n\n` +
      `Style Preferences: ${styleContext}\n` +
      (materials_prompt ? `Materials: ${materials_prompt}\n` : '') +
      refContext +
      `\n\nGenerate a detailed, professional prompt suitable for a text-to-image AI model. ` +
      `Focus on visual elements, textures, colors, and design details. ` +
      `The prompt should be clear, specific, and optimized for high-quality fashion design generation.`;

    const promptOutputSchema = z.object({
      enhanced_prompt: z.string().describe("The optimized prompt for image generation"),
      style_context: z.string().describe("Summary of the design style"),
      technical_details: z.string().optional().describe("Technical details about materials and construction"),
    });

    const response = await designImageAgent.generate(
      [{ role: "user", content: userPrompt }],
      {
        output: promptOutputSchema,
        threadId: threadId,
        resourceId: resourceId || `design-gen:${customer_id}`,
      } as any
    );

    const result: any = response.object || {};

    return {
      enhanced_prompt: result.enhanced_prompt || userPrompt,
      style_context: result.style_context || styleContext,
      technical_details: result.technical_details,
      mode,
      customer_id,
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
    const quotaData = mode === "preview"
      ? { allowed: true, remaining: 45 }
      : { allowed: true, remaining: 8 };

    return {
      ...inputData,
      quota_allowed: quotaData.allowed,
      quota_remaining: quotaData.remaining,
    };
  },
});

// Step 3: Generate image
// Input: step2 output, Output: final result
const generateImageStep = createStep({
  id: "generateImage",
  inputSchema: step2OutputSchema,
  outputSchema: outputSchema,
  execute: async ({ inputData }) => {
    const { enhanced_prompt, style_context, quota_allowed, quota_remaining, mode } = inputData;

    if (!quota_allowed) {
      return {
        image_url: undefined,
        enhanced_prompt,
        style_context,
        quota_remaining,
        error: "Quota exceeded",
      };
    }

    try {
      // TODO: Integrate with actual image generation service
      // Options:
      // 1. Stable Diffusion via Replicate: https://replicate.com/stability-ai/sdxl
      // 2. DALL-E via OpenAI: https://platform.openai.com/docs/guides/images
      // 3. Flux via Replicate: https://replicate.com/black-forest-labs/flux-schnell
      // 4. FAL.ai: https://fal.ai/models/flux/schnell

      console.log(`[ImageGen] Mode: ${mode}, Enhanced Prompt: ${enhanced_prompt}`);

      // Placeholder: Return a mock response
      const mockImageUrl = `https://via.placeholder.com/1024x1024.png?text=${encodeURIComponent('AI Generated Design')}`;

      return {
        image_url: mockImageUrl,
        enhanced_prompt,
        style_context,
        quota_remaining,
        error: undefined,
      };
    } catch (error: any) {
      console.error(`[ImageGen] Error:`, error);
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
