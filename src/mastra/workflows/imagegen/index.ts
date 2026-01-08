// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod/v4";
import { Agent } from "@mastra/core/agent";
import { mistral } from "@ai-sdk/mistral";


/**
 * Design Image Generation Workflow
 *
 * This workflow uses AI SDK's generateImage with Mistral's image model
 * powered by Black Forest Lab FLUX1.1 [pro] Ultra.
 *
 * Step 1: Build and enhance prompt using Mastra agent (text generation)
 * Step 2: Check quota
 * Step 3: Generate image using AI SDK's generateImage with Mistral
 *
 * @see https://docs.mistral.ai/agents/tools/built-in/image_generation
 */

// Create a dedicated agent for design image generation
const designImageAgent = new Agent({
  name: "design-image-agent",
  model: "mistral/mistral-medium-latest",
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

    // Use built-in Mastra model string (e.g., "mistral/pixtral-large-latest") for compatibility
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

/**
 * Generate image using Mistral's Agents API with built-in image_generation tool
 *
 * IMPORTANT: Mistral's image_generation is a server-side built-in tool that only works
 * through the Agents API (POST /v1/agents, POST /v1/conversations).
 * The standard chat API will return a tool_call but won't execute the image generation.
 *
 * Flow:
 * 1. Create an agent with image_generation tool
 * 2. Start a conversation with the prompt
 * 3. Extract file_id from tool_file chunks
 * 4. Download the image
 *
 * @see https://docs.mistral.ai/agents/tools/built-in/image_generation
 */
async function generateImageWithMistralAgentsApi(prompt: string): Promise<{ imageUrl?: string; error?: string }> {
  const apiKey = process.env.MISTRAL_API_KEY;

  if (!apiKey) {
    return { error: "MISTRAL_API_KEY not configured" };
  }

  try {
    console.log(`[ImageGen] Creating Mistral agent with image_generation tool...`);

    // Step 1: Create an agent with image_generation tool
    const agentResponse = await fetch("https://api.mistral.ai/v1/agents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "mistral-medium-latest",
        name: `fashion-image-gen-${Date.now()}`,
        description: "Agent for generating fashion design images",
        instructions: "You are a fashion design image generator. Generate high-quality fashion design images based on the provided prompt. Always use the image_generation tool.",
        tools: [{ type: "image_generation" }],
        completion_args: {
          temperature: 0.7,
          top_p: 0.95,
        },
      }),
    });

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text();
      console.error(`[ImageGen] Failed to create agent: ${agentResponse.status}`, errorText);
      return { error: `Failed to create agent: ${agentResponse.status} - ${errorText}` };
    }

    const agent = await agentResponse.json();
    const agentId = agent.id;
    console.log(`[ImageGen] Created agent: ${agentId}`);

    // Step 2: Start a conversation with the prompt
    console.log(`[ImageGen] Starting conversation...`);
    const conversationResponse = await fetch("https://api.mistral.ai/v1/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        agent_id: agentId,
        inputs: prompt,
      }),
    });

    if (!conversationResponse.ok) {
      const errorText = await conversationResponse.text();
      console.error(`[ImageGen] Conversation failed: ${conversationResponse.status}`, errorText);
      // Cleanup: delete the agent
      await fetch(`https://api.mistral.ai/v1/agents/${agentId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      return { error: `Conversation failed: ${conversationResponse.status} - ${errorText}` };
    }

    const conversation = await conversationResponse.json();
    console.log(`[ImageGen] Conversation response:`, JSON.stringify(conversation, null, 2));

    // Step 3: Extract file_id and file_type from the response
    let fileId: string | undefined;
    let fileType: string = "png"; // Default to png

    // Check outputs for tool_file chunks
    if (conversation.outputs && Array.isArray(conversation.outputs)) {
      for (const output of conversation.outputs) {
        // Check message.output type entries
        if (output.content && Array.isArray(output.content)) {
          for (const chunk of output.content) {
            if (chunk.type === "tool_file" && chunk.tool === "image_generation" && chunk.file_id) {
              fileId = chunk.file_id;
              // Extract file_type from the response (e.g., "png", "jpg")
              if (chunk.file_type) {
                fileType = chunk.file_type;
              }
              console.log(`[ImageGen] Found file_id: ${fileId}, file_type: ${fileType}`);
              break;
            }
          }
        }
        if (fileId) break;
      }
    }

    // Cleanup: delete the agent (we don't need it anymore)
    await fetch(`https://api.mistral.ai/v1/agents/${agentId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${apiKey}` },
    }).catch(() => {}); // Ignore cleanup errors

    if (!fileId) {
      console.log(`[ImageGen] No image file_id found in response`);
      return { error: "No image generated in response" };
    }

    // Step 4: Download the generated image
    console.log(`[ImageGen] Downloading image: ${fileId}`);
    const fileResponse = await fetch(`https://api.mistral.ai/v1/files/${fileId}/content`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    if (!fileResponse.ok) {
      console.error(`[ImageGen] Failed to download image: ${fileResponse.status}`);
      return { error: `Failed to download image: ${fileResponse.status}` };
    }

    const imageBuffer = await fileResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    // Use file_type from Mistral response to determine mime type
    // The content-type header from Mistral file download returns "application/octet-stream"
    // so we use the file_type from the tool_file chunk instead
    const mimeType = `image/${fileType}`;
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    console.log(`[ImageGen] Successfully generated image (${imageBuffer.byteLength} bytes, type: ${mimeType})`);
    return { imageUrl };

  } catch (error: any) {
    console.error(`[ImageGen] Error:`, error);
    return { error: error?.message || "Failed to generate image" };
  }
}

// Step 3: Generate image using Mistral's Agents API
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
      console.log(`[ImageGen] Mode: ${mode}, Generating image with Mistral Agents API...`);
      console.log(`[ImageGen] Enhanced Prompt: ${enhanced_prompt}`);

      // Try to generate image using Mistral's Agents API
      const { imageUrl, error } = await generateImageWithMistralAgentsApi(enhanced_prompt);

      if (error || !imageUrl) {
        console.log(`[ImageGen] Generation failed or not supported: ${error}`);
        // Fallback to placeholder for development
        const placeholderUrl = `https://picsum.photos/1024/1024?random=${Date.now()}`;
        return {
          image_url: placeholderUrl,
          enhanced_prompt,
          style_context,
          quota_remaining,
          error: error || "Using placeholder image",
        };
      }

      return {
        image_url: imageUrl,
        enhanced_prompt,
        style_context,
        quota_remaining,
        error: undefined,
      };
    } catch (error: any) {
      console.error(`[ImageGen] Error:`, error);
      // Fallback to placeholder
      const placeholderUrl = `https://picsum.photos/1024/1024?random=${Date.now()}`;
      return {
        image_url: placeholderUrl,
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
