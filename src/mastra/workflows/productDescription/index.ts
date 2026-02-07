// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod/v4";
import { createProductDescriptionAgent } from "../../agents";
import { getFreeVisionModels } from "../../providers/openrouter";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Agent } from "@mastra/core/agent";
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger();

// Rate limit handling config
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 5000; // 5 seconds
const MAX_RETRY_DELAY_MS = 60000; // 60 seconds

// Helper to check if error is rate limit
function isRateLimitError(error: any): boolean {
  return (
    error?.statusCode === 429 ||
    error?.cause?.statusCode === 429 ||
    error?.message?.includes("429") ||
    error?.message?.includes("rate-limited") ||
    error?.responseBody?.includes("rate-limited")
  );
}

// Helper to sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Create agent with specific model
async function createAgentWithModel(modelId: string): Promise<Agent> {
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
  logger.info(`Creating agent with model: ${modelId}`);
  return new Agent({
    model: openrouter(modelId) as any,
    name: "ProductDescriptionAgent",
    instructions:
      "You are an expert product description writer. Given an image and product information, you will generate a compelling and accurate product description. Focus on highlighting key features and benefits that would appeal to the target audience.",
  });
}

// 1. Define the input schema for the workflow
const triggerSchema = z.object({
  imageUrl: z.string().url("A valid image URL is required."),
  hint: z.string().optional(),
  productData: z.object({
    designers: z.array(z.string()).optional(),
    modelUsed: z.string().optional(),
    materialType: z.string().optional(),
  }).optional().default({}),
});

// 2. Define the output schema for the AI-generated content
const productDescriptionSchema = z.object({
  title: z.string(),
  description: z.string(),
});

// 4. Create the step to generate the description from the AI agent
const generateDescriptionStep = createStep({
  id: 'generateDescription',
  inputSchema: triggerSchema,
  outputSchema: productDescriptionSchema,
  execute: async ({ inputData }) => {
    const { imageUrl, productData, hint } = inputData;

    logger.info(`Generating product description for image: ${imageUrl}`);

    // Get all available free vision models for fallback
    let availableModels: string[] = [];
    try {
      const visionModels = await getFreeVisionModels();
      availableModels = visionModels.map((m) => m.id);
      logger.info(`Available vision models for fallback: ${availableModels.slice(0, 5).join(", ")}`);
    } catch {
      // Fallback list if API fails
      availableModels = [
        "google/gemini-2.0-flash-exp:free",
        "google/gemma-3-27b-it:free",
        "nvidia/nemotron-nano-12b-v2-vl:free",
        "mistralai/mistral-small-3.1-24b-instruct:free",
        "meta-llama/llama-3.2-11b-vision-instruct:free",
      ];
    }

    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `Generate a product title and description. You MUST respond with ONLY a JSON object in this exact format, no other text:\n{"title": "your title here", "description": "your description here"}\n\n${hint ? `Writer hint: ${hint}\n` : ""}Product Details: ${JSON.stringify(productData || {}, null, 2)}`,
          },
          { type: "image_url" as const, imageUrl: { url: imageUrl } },
        ],
      },
    ];

    let lastError: any = null;
    let modelIndex = 0;

    // Try each model with retries
    while (modelIndex < availableModels.length) {
      const currentModel = availableModels[modelIndex];
      let retryCount = 0;

      while (retryCount < MAX_RETRIES) {
        try {
          const agent = await createAgentWithModel(currentModel);
          logger.info(`Attempting generation with model: ${currentModel} (attempt ${retryCount + 1})`);

          const response = await agent.generate(messages);

          // Parse JSON from response (handles markdown code blocks)
          let parsed: { title: string; description: string };
          const text = response.text.trim();

          try {
            parsed = JSON.parse(text);
          } catch {
            // Try extracting JSON from markdown code blocks
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[1].trim());
            } else {
              // Try to find JSON object in the text
              const objectMatch = text.match(/\{[\s\S]*?"title"[\s\S]*?"description"[\s\S]*?\}/);
              if (objectMatch) {
                parsed = JSON.parse(objectMatch[0]);
              } else {
                throw new Error(`Could not parse JSON from response: ${text.substring(0, 200)}...`);
              }
            }
          }

          logger.info(`Successfully generated description with model: ${currentModel}`);
          return { title: parsed.title, description: parsed.description };
        } catch (error: any) {
          lastError = error;
          const errorMsg = error?.message || String(error);
          logger.warn(`Error with model ${currentModel} (attempt ${retryCount + 1}): ${errorMsg}`);

          if (isRateLimitError(error)) {
            retryCount++;
            if (retryCount < MAX_RETRIES) {
              // Exponential backoff with jitter
              const delay = Math.min(
                INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1) + Math.random() * 2000,
                MAX_RETRY_DELAY_MS
              );
              logger.info(`Rate limited on ${currentModel}. Waiting ${Math.round(delay / 1000)}s before retry...`);
              await sleep(delay);
            } else {
              // Max retries for this model, try next model
              logger.warn(`Max retries reached for ${currentModel}. Trying next model...`);
              break;
            }
          } else {
            // Non-rate-limit error, try next model immediately
            logger.warn(`Non-rate-limit error on ${currentModel}. Trying next model...`);
            break;
          }
        }
      }

      modelIndex++;
      if (modelIndex < availableModels.length) {
        logger.info(`Switching to fallback model: ${availableModels[modelIndex]}`);
      }
    }

    // All models exhausted
    throw new Error(
      `All vision models exhausted after retries. Last error: ${lastError?.message || String(lastError)}`
    );
  },
});

// 5. Create a validation step
const validateDescriptionStep = createStep({
  id: 'validateDescription',
  inputSchema: productDescriptionSchema,
  outputSchema: productDescriptionSchema,
  execute: async ({ inputData }) => {
    const { description } = inputData;

    if (description.length < 50) {
        logger.warn(`Generated description is very short (${description.length} characters).`);
    }

    if (description.length > 1000) {
        logger.warn(`Generated description is very long (${description.length} characters).`);
    }

    // Return the validated data
    return inputData;
  },
});

// 6. Create and export the workflow
export const productDescriptionWorkflow = createWorkflow({
    id: 'product-description-generation',
    inputSchema: triggerSchema,
    outputSchema: productDescriptionSchema,
})
.then(generateDescriptionStep)
.then(validateDescriptionStep)
.commit();

export default productDescriptionWorkflow;
