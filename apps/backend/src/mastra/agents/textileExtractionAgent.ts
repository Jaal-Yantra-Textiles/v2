// @ts-nocheck - Ignore all TypeScript errors in this file
import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getVisionModelId, getFreeVisionModels } from "../providers/openrouter";
import { memory } from "../memory";

// Default vision model (fallback)
const DEFAULT_VISION_MODEL = "google/gemini-2.0-flash-exp:free";

// Rate limit handling config
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 5000; // 5 seconds
const MAX_RETRY_DELAY_MS = 60000; // 60 seconds

// Helper to check if error is rate limit
export function isRateLimitError(error: any): boolean {
  return (
    error?.statusCode === 429 ||
    error?.cause?.statusCode === 429 ||
    error?.message?.includes("429") ||
    error?.message?.includes("rate-limited") ||
    error?.responseBody?.includes("rate-limited")
  );
}

// Helper to sleep
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Instructions for the textile extraction agent
 */
const TEXTILE_EXTRACTION_INSTRUCTIONS = `You are an expert textile product analyst specializing in fashion and fabric analysis.
Given an image of a textile product, extract comprehensive information for e-commerce cataloging.

You MUST respond with ONLY a JSON object in this exact format, no other text:
{
  "title": "Product title",
  "description": "Detailed product description (2-3 sentences)",
  "designer": "Designer or brand name if visible",
  "model_name": "Model/style name if identifiable",
  "cloth_type": "Type of fabric (e.g., Silk, Cotton, Linen, Wool, Polyester)",
  "pattern": "Pattern type (e.g., Solid, Floral, Geometric, Stripes, Abstract)",
  "fabric_weight": "Fabric weight category (Light, Medium, Heavy)",
  "care_instructions": ["Array of care instructions"],
  "season": ["Appropriate seasons (Spring, Summer, Fall, Winter)"],
  "occasion": ["Suitable occasions (Casual, Formal, Party, Wedding, Office)"],
  "colors": ["Array of identified colors"],
  "category": "Product category",
  "suggested_price": {"amount": 0, "currency": "USD"},
  "seo_keywords": ["Array of SEO keywords"],
  "target_audience": "Target demographic description",
  "confidence": 0.0
}

Guidelines:
- Be specific and accurate based on what's visible in the image
- For fields that cannot be determined, use null or empty arrays
- Confidence score should reflect overall certainty (0.0 to 1.0)
- Price estimates should be reasonable for the product category
- SEO keywords should be relevant for e-commerce search`;

/**
 * Static textile extraction agent (for backward compatibility)
 */
export const textileExtractionAgent = new Agent({
  name: "textile-extraction-agent",
  model: createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })(DEFAULT_VISION_MODEL) as any,
  instructions: TEXTILE_EXTRACTION_INSTRUCTIONS,
  memory,
});

/**
 * Factory function to create a TextileExtractionAgent with dynamically selected model
 * Use this when you need the best available free vision model
 */
export async function createTextileExtractionAgent(): Promise<Agent> {
  const modelId = await getVisionModelId();
  console.log(`[TextileExtractionAgent] Using dynamic model: ${modelId}`);

  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

  return new Agent({
    name: "textile-extraction-agent",
    model: openrouter(modelId) as any,
    instructions: TEXTILE_EXTRACTION_INSTRUCTIONS,
    memory,
  });
}

/**
 * Create agent with a specific model ID
 * @param modelId - The model ID to use
 * @param useMemory - Whether to use memory (default: false for one-shot extractions)
 */
export async function createTextileAgentWithModel(
  modelId: string,
  useMemory: boolean = false
): Promise<Agent> {
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
  console.log(`[TextileExtractionAgent] Creating agent with model: ${modelId}, memory: ${useMemory}`);

  const config: any = {
    name: "textile-extraction-agent",
    model: openrouter(modelId) as any,
    instructions: TEXTILE_EXTRACTION_INSTRUCTIONS,
  };

  // Only add memory if requested
  if (useMemory) {
    config.memory = memory;
  }

  return new Agent(config);
}

/**
 * Get fallback vision models for retry logic
 */
export async function getTextileFallbackModels(): Promise<string[]> {
  try {
    const visionModels = await getFreeVisionModels();
    return visionModels.map((m) => m.id);
  } catch {
    // Fallback list if API fails
    return [
      "google/gemini-2.0-flash-exp:free",
      "google/gemma-3-27b-it:free",
      "nvidia/nemotron-nano-12b-v2-vl:free",
      "mistralai/mistral-small-3.1-24b-instruct:free",
      "meta-llama/llama-3.2-11b-vision-instruct:free",
    ];
  }
}

export { MAX_RETRIES, INITIAL_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS };
