/**
 * Model Selector
 *
 * Fetches available image generation models from Vercel AI Gateway
 * using the AI SDK's gateway.getAvailableModels() method and selects
 * the cheapest available option.
 *
 * Model Types:
 * - Image Models: Dedicated image generation (e.g., Imagen, FLUX, BFL)
 * - Text Models with Image Output: Multi-modal text models that can output images
 *
 * @see https://vercel.com/docs/ai-gateway/models-and-providers#dynamic-model-discovery
 * @see https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway
 */

import { experimental_generateImage as generateImage, gateway } from "ai";

export type ModelType = "image" | "text-with-image" | "language";

export type ImageModel = {
  id: string;
  provider: string;
  name: string;
  type: ModelType;
  pricePerImage?: number; // Price per image in USD
  inputPricePerMillion?: number; // For text models
  outputPricePerMillion?: number; // For text models
};

// Cache for fetched models
let cachedModels: ImageModel[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Known prices per image (from Vercel AI Gateway catalog)
 * Used as fallback when API doesn't return pricing.per_image
 */
const KNOWN_PRICES: Record<string, number> = {
  // Google models
  "google/imagen-4.0-fast-generate-001": 0.02,
  "google/gemini-2.5-flash-image": 0.039,
  "google/gemini-2.5-flash-image-preview": 0.039,
  "google/imagen-4.0-generate-001": 0.04,
  "google/imagen-4.0-ultra-generate-001": 0.06,
  "google/gemini-3-pro-image": 0.12,
  // Black Forest Labs FLUX
  "bfl/flux-pro-1.1": 0.04,
  "bfl/flux-kontext-pro": 0.04,
  "bfl/flux-pro-1.0-fill": 0.05,
  "bfl/flux-pro-1.1-ultra": 0.06,
  "bfl/flux-kontext-max": 0.08,
};

/**
 * Fetch models from Vercel AI Gateway using AI SDK's gateway.getAvailableModels()
 *
 * @see https://vercel.com/docs/ai-gateway/models-and-providers#dynamic-model-discovery
 */
async function fetchModelsFromVercel(): Promise<ImageModel[]> {
  const now = Date.now();

  // Return cached models if still valid
  if (cachedModels && now - cacheTimestamp < CACHE_TTL_MS) {
    console.log(`[ModelSelector] Using cached models (${cachedModels.length} models)`);
    return cachedModels;
  }

  console.log(`[ModelSelector] Fetching models from Vercel AI Gateway via AI SDK...`);

  try {
    // Use AI SDK's gateway.getAvailableModels() method
    const result = await gateway.getAvailableModels();
    const allModels = result.models || [];
    console.log(`[ModelSelector] Fetched ${allModels.length} models from gateway`);
    // Filter for image models (type === 'image')
    const imageModels: ImageModel[] = [];

    for (const model of allModels) {
      // Check if it's an image model by type or id patterns
      const isImageModel =
        (model as any).type === "image" ||
        model.id?.toLowerCase().includes("image") ||
        model.id?.toLowerCase().includes("imagen") ||
        model.id?.toLowerCase().includes("flux") ||
        model.id?.startsWith("bfl/");

      if (isImageModel) {
        // For image models, pricing is in pricing.per_image
        const pricing = (model as any).pricing;
        const pricePerImage = pricing?.per_image
          ? parseFloat(pricing.per_image)
          : KNOWN_PRICES[model.id] ?? undefined;

        imageModels.push({
          id: model.id,
          provider: (model as any).owned_by || model.id.split("/")[0] || "unknown",
          name: (model as any).display_name || (model as any).name || model.id.split("/")[1] || model.id,
          type: "image",
          pricePerImage,
        });

        console.log(
          `[ModelSelector] Found image model: ${model.id} @ $${pricePerImage}/image`
        );
      }
    }

    // If we found image models, cache and return them
    if (imageModels.length > 0) {
      cachedModels = imageModels;
      cacheTimestamp = now;
      console.log(`[ModelSelector] Fetched ${imageModels.length} image models from gateway`);
      return imageModels;
    }

    // Fall back to known models if gateway didn't return image models
    console.log(`[ModelSelector] No image models found in gateway, using known models`);
    return getKnownImageModels();
  } catch (error) {
    console.error(`[ModelSelector] Error fetching models from gateway:`, error);
    return getKnownImageModels();
  }
}

/**
 * Known image generation models with their pricing (fallback)
 * Based on Vercel AI Gateway catalog
 */
function getKnownImageModels(): ImageModel[] {
  return [
    // Google Imagen - sorted by price
    {
      id: "google/imagen-4.0-fast-generate-001",
      provider: "google",
      name: "Imagen 4.0 Fast",
      type: "image",
      pricePerImage: 0.02,
    },
    {
      id: "google/gemini-2.5-flash-image-preview",
      provider: "google",
      name: "Gemini 2.5 Flash Image Preview",
      type: "image",
      pricePerImage: 0.039,
    },
    {
      id: "google/gemini-2.5-flash-image",
      provider: "google",
      name: "Gemini 2.5 Flash Image",
      type: "image",
      pricePerImage: 0.039,
    },
    {
      id: "google/imagen-4.0-generate-001",
      provider: "google",
      name: "Imagen 4.0",
      type: "image",
      pricePerImage: 0.04,
    },
    {
      id: "google/imagen-4.0-ultra-generate-001",
      provider: "google",
      name: "Imagen 4.0 Ultra",
      type: "image",
      pricePerImage: 0.06,
    },
    {
      id: "google/gemini-3-pro-image",
      provider: "google",
      name: "Gemini 3 Pro Image",
      type: "image",
      pricePerImage: 0.12,
    },
    // Black Forest Labs FLUX
    {
      id: "bfl/flux-pro-1.1",
      provider: "bfl",
      name: "FLUX Pro 1.1",
      type: "image",
      pricePerImage: 0.04,
    },
    {
      id: "bfl/flux-kontext-pro",
      provider: "bfl",
      name: "FLUX Kontext Pro",
      type: "image",
      pricePerImage: 0.04,
    },
    {
      id: "bfl/flux-pro-1.0-fill",
      provider: "bfl",
      name: "FLUX Pro 1.0 Fill",
      type: "image",
      pricePerImage: 0.05,
    },
    {
      id: "bfl/flux-pro-1.1-ultra",
      provider: "bfl",
      name: "FLUX Pro 1.1 Ultra",
      type: "image",
      pricePerImage: 0.06,
    },
    {
      id: "bfl/flux-kontext-max",
      provider: "bfl",
      name: "FLUX Kontext Max",
      type: "image",
      pricePerImage: 0.08,
    },
  ];
}

/**
 * Get all image models sorted by price (cheapest first)
 * Models without known prices are placed at the end
 *
 * @param fetchFromApi - Whether to fetch from Vercel API (default: true)
 * @returns Array of models sorted by price
 */
export async function getImageModelsByPrice(
  fetchFromApi: boolean = true
): Promise<ImageModel[]> {
  const models = fetchFromApi
    ? await fetchModelsFromVercel()
    : getKnownImageModels();

  return models
    .filter((m) => m.type === "image")
    .sort((a, b) => {
      // Models with known prices come first, sorted by price
      // Models without prices go to the end
      const priceA = a.pricePerImage ?? Infinity;
      const priceB = b.pricePerImage ?? Infinity;
      return priceA - priceB;
    });
}

/**
 * Get the cheapest image model
 */
export async function getCheapestImageModel(): Promise<ImageModel | undefined> {
  const models = await getImageModelsByPrice();
  return models[0];
}

/**
 * Generate image using the cheapest available model
 *
 * Tries models in order of price (cheapest first) until one succeeds.
 *
 * @param prompt - The image generation prompt
 * @returns Base64 image URL and model used, or error
 */
export async function generateWithCheapestModel(
  prompt: string
): Promise<{
  success: boolean;
  imageUrl?: string;
  modelUsed?: string;
  pricePerImage?: number;
  error?: string;
}> {
  const sortedModels = await getImageModelsByPrice();

  console.log(
    `[ModelSelector] Trying ${sortedModels.length} models in price order...`
  );
  console.log(
    `[ModelSelector] Order: ${sortedModels.map((m) => `${m.id} ($${m.pricePerImage})`).join(" → ")}`
  );

  for (const model of sortedModels) {
    console.log(
      `[ModelSelector] Trying ${model.id} (${model.name}) @ $${model.pricePerImage}/image...`
    );

    try {
      // Use generateImage for dedicated image models
      const { image } = await generateImage({
        model: model.id,
        prompt,
        aspectRatio: "1:1",
      });

      if (image?.base64) {
        console.log(`[ModelSelector] Success with ${model.id}`);
        return {
          success: true,
          imageUrl: `data:image/png;base64,${image.base64}`,
          modelUsed: model.id,
          pricePerImage: model.pricePerImage,
        };
      }

      console.log(`[ModelSelector] ${model.id} returned no image`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[ModelSelector] ${model.id} failed: ${message}`);

      // Check for rate limit - skip to next model
      if (
        message.includes("429") ||
        message.toLowerCase().includes("rate limit")
      ) {
        console.log(`[ModelSelector] ${model.id} rate limited, trying next...`);
        continue;
      }

      // For other errors, also try next model
      continue;
    }
  }

  return {
    success: false,
    error: "All models failed",
  };
}

/**
 * Clear the model cache (useful for testing or forcing refresh)
 */
export function clearModelCache(): void {
  cachedModels = null;
  cacheTimestamp = 0;
  console.log(`[ModelSelector] Cache cleared`);
}

/**
 * Get all available models (for debugging/display)
 */
export async function getAllImageModels(): Promise<ImageModel[]> {
  return getImageModelsByPrice();
}
