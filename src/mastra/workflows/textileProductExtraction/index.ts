// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod/v4";
import {
  createTextileExtractionAgent,
  createTextileAgentWithModel,
  getTextileFallbackModels,
  isRateLimitError,
  sleep,
  MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
} from "../../agents/textileExtractionAgent";
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger();

// Input schema for the workflow
export const triggerSchema = z.object({
  image_url: z
    .string()
    .refine(
      (s) => {
        if (!s) return false;
        if (s.startsWith("data:")) {
          const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
          const mime = s.slice(5, s.indexOf(";")) || "";
          return allowed.includes(mime);
        }
        try {
          new URL(s);
          return true;
        } catch {
          return false;
        }
      },
      { message: "image_url must be a valid URL or a data URI of type png/jpeg/webp/gif" }
    ),
  hints: z.array(z.string()).optional().default([]),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
});

// Output schema for textile product extraction
export const textileProductSchema = z.object({
  title: z.string(),
  description: z.string(),
  designer: z.string().nullable().optional(),
  model_name: z.string().nullable().optional(),
  cloth_type: z.string().nullable().optional(),
  pattern: z.string().nullable().optional(),
  fabric_weight: z.string().nullable().optional(),
  care_instructions: z.array(z.string()).optional().default([]),
  season: z.array(z.string()).optional().default([]),
  occasion: z.array(z.string()).optional().default([]),
  colors: z.array(z.string()).optional().default([]),
  category: z.string().nullable().optional(),
  suggested_price: z
    .object({
      amount: z.number(),
      currency: z.string().default("USD"),
    })
    .nullable()
    .optional(),
  seo_keywords: z.array(z.string()).optional().default([]),
  target_audience: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type TextileProductExtractionInput = z.infer<typeof triggerSchema>;
export type TextileProductExtractionOutput = z.infer<typeof textileProductSchema>;

// Helper to infer MIME type from URL
const inferMime = (u: string): string => {
  try {
    const lower = u.toLowerCase();
    if (lower.startsWith("data:")) {
      const semi = lower.indexOf(";");
      return lower.slice(5, semi >= 0 ? semi : undefined);
    }
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
  } catch {}
  return "";
};

// Step to extract textile product features from image
const extractTextileFeaturesStep = createStep({
  id: "extractTextileFeatures",
  inputSchema: triggerSchema,
  outputSchema: textileProductSchema,
  execute: async ({ inputData }) => {
    const { image_url, hints, threadId, resourceId } = inputData;

    logger.info(`[TextileExtraction] Starting extraction for image: ${image_url.substring(0, 50)}...`);

    // Get fallback models
    const availableModels = await getTextileFallbackModels();
    logger.info(`[TextileExtraction] Available vision models: ${availableModels.slice(0, 5).join(", ")}`);

    // Prepare image for agent
    let imageForAgent = image_url;
    let mimeType = inferMime(image_url);

    if (image_url.startsWith("http")) {
      try {
        const resp = await fetch(image_url);
        const buf = Buffer.from(await resp.arrayBuffer());

        // Detect from magic bytes
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
        const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
        const isWebp =
          buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";

        if (isPng) mimeType = "image/png";
        else if (isJpeg) mimeType = "image/jpeg";
        else if (isGif) mimeType = "image/gif";
        else if (isWebp) mimeType = "image/webp";
        else {
          const ct = resp.headers.get("content-type") || "";
          if (ct.startsWith("image/")) mimeType = ct.split(";")[0].trim();
        }

        const b64 = buf.toString("base64");
        imageForAgent = `data:${mimeType};base64,${b64}`;
      } catch (err) {
        logger.warn(`[TextileExtraction] Failed to fetch image, using URL directly: ${err}`);
      }
    }

    if (!mimeType) mimeType = "image/jpeg";

    // Build prompt with hints
    const hintsText = hints && hints.length > 0 ? `\n\nAdditional hints: ${hints.join(", ")}` : "";

    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "image" as const,
            image: imageForAgent,
            mimeType,
          },
          {
            type: "text" as const,
            text: `Analyze this textile product image and extract comprehensive product information for e-commerce cataloging.${hintsText}`,
          },
        ],
      },
    ];

    // Stable resource ID
    const stableResourceId =
      resourceId && !String(resourceId).startsWith("textile-extraction:http")
        ? resourceId
        : "textile-extraction:product-analysis";

    let lastError: any = null;
    let modelIndex = 0;

    // Try each model with retries
    while (modelIndex < availableModels.length) {
      const currentModel = availableModels[modelIndex];
      let retryCount = 0;

      while (retryCount < MAX_RETRIES) {
        try {
          // Create agent without memory for one-shot extraction (better performance)
          const agent = await createTextileAgentWithModel(currentModel, false);
          logger.info(`[TextileExtraction] Attempting with model: ${currentModel} (attempt ${retryCount + 1})`);

          // No need to pass threadId/resourceId when not using memory
          const response = await agent.generate(messages, {
            output: textileProductSchema,
          } as any);

          // Parse response
          let parsed: TextileProductExtractionOutput;

          if (response.object) {
            parsed = response.object as TextileProductExtractionOutput;
          } else {
            const text = response.text?.trim() || "";
            try {
              parsed = JSON.parse(text);
            } catch {
              // Try extracting JSON from markdown code blocks
              const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
              if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[1].trim());
              } else {
                // Try to find JSON object in the text
                const objectMatch = text.match(/\{[\s\S]*?"title"[\s\S]*?\}/);
                if (objectMatch) {
                  parsed = JSON.parse(objectMatch[0]);
                } else {
                  throw new Error(`Could not parse JSON from response: ${text.substring(0, 200)}...`);
                }
              }
            }
          }

          logger.info(`[TextileExtraction] Successfully extracted with model: ${currentModel}`);
          return parsed;
        } catch (error: any) {
          lastError = error;
          const errorMsg = error?.message || String(error);
          logger.warn(`[TextileExtraction] Error with model ${currentModel} (attempt ${retryCount + 1}): ${errorMsg}`);

          if (isRateLimitError(error)) {
            retryCount++;
            if (retryCount < MAX_RETRIES) {
              const delay = Math.min(
                INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1) + Math.random() * 2000,
                MAX_RETRY_DELAY_MS
              );
              logger.info(`[TextileExtraction] Rate limited. Waiting ${Math.round(delay / 1000)}s before retry...`);
              await sleep(delay);
            } else {
              logger.warn(`[TextileExtraction] Max retries for ${currentModel}. Trying next model...`);
              break;
            }
          } else {
            logger.warn(`[TextileExtraction] Non-rate-limit error. Trying next model...`);
            break;
          }
        }
      }

      modelIndex++;
      if (modelIndex < availableModels.length) {
        logger.info(`[TextileExtraction] Switching to fallback model: ${availableModels[modelIndex]}`);
      }
    }

    throw new Error(
      `[TextileExtraction] All vision models exhausted. Last error: ${lastError?.message || String(lastError)}`
    );
  },
});

// Step to validate and normalize extraction results
const validateExtractionStep = createStep({
  id: "validateTextileExtraction",
  inputSchema: textileProductSchema,
  outputSchema: textileProductSchema,
  execute: async ({ inputData }) => {
    logger.info(`[TextileExtraction] Validating extraction results...`);

    // Normalize and clean up the data
    const normalized: TextileProductExtractionOutput = {
      title: inputData.title || "Untitled Product",
      description: inputData.description || "",
      designer: inputData.designer || null,
      model_name: inputData.model_name || null,
      cloth_type: inputData.cloth_type || null,
      pattern: inputData.pattern || null,
      fabric_weight: inputData.fabric_weight || null,
      care_instructions: Array.isArray(inputData.care_instructions) ? inputData.care_instructions : [],
      season: Array.isArray(inputData.season) ? inputData.season : [],
      occasion: Array.isArray(inputData.occasion) ? inputData.occasion : [],
      colors: Array.isArray(inputData.colors) ? inputData.colors : [],
      category: inputData.category || null,
      suggested_price: inputData.suggested_price
        ? {
            amount: Number(inputData.suggested_price.amount) || 0,
            currency: inputData.suggested_price.currency || "USD",
          }
        : null,
      seo_keywords: Array.isArray(inputData.seo_keywords) ? inputData.seo_keywords : [],
      target_audience: inputData.target_audience || null,
      confidence:
        typeof inputData.confidence === "number"
          ? Math.max(0, Math.min(1, inputData.confidence))
          : undefined,
    };

    // Log warnings for missing important fields
    if (!normalized.title || normalized.title === "Untitled Product") {
      logger.warn("[TextileExtraction] Missing product title");
    }
    if (!normalized.description) {
      logger.warn("[TextileExtraction] Missing product description");
    }
    if (normalized.colors.length === 0) {
      logger.warn("[TextileExtraction] No colors identified");
    }

    logger.info(`[TextileExtraction] Validation complete. Confidence: ${normalized.confidence || "N/A"}`);
    return normalized;
  },
});

// Create and export the workflow
export const textileProductExtractionWorkflow = createWorkflow({
  id: "textile-product-extraction",
  inputSchema: triggerSchema,
  outputSchema: textileProductSchema,
})
  .then(extractTextileFeaturesStep)
  .then(validateExtractionStep)
  .commit();

export default textileProductExtractionWorkflow;
