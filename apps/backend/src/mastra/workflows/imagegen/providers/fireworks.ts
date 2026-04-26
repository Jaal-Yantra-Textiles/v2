/**
 * Fireworks AI Provider
 *
 * Uses AI SDK's experimental_generateImage with Vercel Gateway
 * Model: fireworks/flux-1-dev-fp8 (FLUX image generation model)
 *
 * Fireworks supports image generation through the generateImage API.
 *
 * @see https://ai-sdk.dev/providers/ai-sdk-providers/fireworks
 */

import { experimental_generateImage as generateImage } from "ai";
import { GenerationResult } from "./index";

const PROVIDER_NAME = "fireworks" as const;

/**
 * Generate an image using Fireworks AI with FLUX model
 *
 * @param prompt - The text prompt for image generation
 * @returns GenerationResult with base64 data URL on success
 */
export async function generateWithFireworks(
  prompt: string
): Promise<GenerationResult> {
  try {
    console.log(`[ImageGen:Fireworks] Generating image with FLUX...`);
    console.log(`[ImageGen:Fireworks] Prompt: ${prompt.substring(0, 100)}...`);

    const { image } = await generateImage({
      model: "fireworks/accounts/fireworks/models/flux-1-dev-fp8",
      prompt,
      aspectRatio: "1:1",
    });

    if (!image || !image.base64) {
      console.error(`[ImageGen:Fireworks] No image returned from API`);
      return {
        success: false,
        provider: PROVIDER_NAME,
        error: "No image returned from Fireworks",
        errorCode: "UNKNOWN",
      };
    }

    const imageUrl = `data:image/png;base64,${image.base64}`;
    console.log(
      `[ImageGen:Fireworks] Successfully generated image (${image.base64.length} chars base64)`
    );

    return {
      success: true,
      imageUrl,
      provider: PROVIDER_NAME,
    };
  } catch (error: unknown) {
    console.error(`[ImageGen:Fireworks] Error:`, error);

    // Check for rate limit errors
    if (isFireworksRateLimitError(error)) {
      return {
        success: false,
        provider: PROVIDER_NAME,
        error: "Fireworks rate limit exceeded",
        errorCode: "RATE_LIMITED",
      };
    }

    // Check for server errors (5xx)
    if (isServerError(error)) {
      return {
        success: false,
        provider: PROVIDER_NAME,
        error: `Fireworks server error: ${getErrorMessage(error)}`,
        errorCode: "SERVER_ERROR",
      };
    }

    return {
      success: false,
      provider: PROVIDER_NAME,
      error: getErrorMessage(error),
      errorCode: "UNKNOWN",
    };
  }
}

/**
 * Check if error is a rate limit error from Fireworks
 */
function isFireworksRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("429") ||
      message.includes("rate limit") ||
      message.includes("too many requests")
    );
  }
  if (typeof error === "object" && error !== null) {
    const anyError = error as Record<string, unknown>;
    if (anyError.status === 429) return true;
    if (anyError.code === 429) return true;
  }
  return false;
}

/**
 * Check if error is a server error (5xx)
 */
function isServerError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const anyError = error as Record<string, unknown>;
    if (typeof anyError.status === "number") {
      return anyError.status >= 500 && anyError.status < 600;
    }
  }
  return false;
}

/**
 * Extract error message from unknown error
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const anyError = error as Record<string, unknown>;
    if (typeof anyError.message === "string") {
      return anyError.message;
    }
    if (typeof anyError.error === "string") {
      return anyError.error;
    }
  }
  return "Unknown error occurred";
}
