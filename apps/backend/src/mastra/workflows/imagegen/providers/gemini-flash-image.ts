/**
 * Gemini Flash Image Provider
 *
 * Uses AI SDK's generateText with Gemini 2.5 Flash which supports
 * multi-modal outputs including images via the files property.
 *
 * Model: gemini-2.5-flash-preview (text model with image generation capability)
 *
 * @see https://ai-sdk.dev/docs/ai-sdk-core/generating-text#generating-images-with-language-models
 */

import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { GenerationResult } from "./index";

const PROVIDER_NAME = "gemini-flash" as const;

/**
 * Generate an image using Gemini 2.5 Flash's multi-modal output
 *
 * Uses generateText which returns images in the files property.
 *
 * @param prompt - The text prompt for image generation
 * @returns GenerationResult with base64 data URL on success
 */
export async function generateWithGeminiFlash(
  prompt: string
): Promise<GenerationResult> {
  try {
    console.log(`[ImageGen:GeminiFlash] Generating image with Gemini 2.5 Flash...`);
    console.log(`[ImageGen:GeminiFlash] Prompt: ${prompt.substring(0, 100)}...`);

    const result = await generateText({
      model: "google/gemini-2.5-flash-preview",
      prompt: `Generate an image: ${prompt}`,
    });

    console.log(`[ImageGen:GeminiFlash] Response received, checking files...`);

    // Check for images in the files property
    if (result.files && result.files.length > 0) {
      for (const file of result.files) {
        if (file.mediaType.startsWith("image/")) {
          // file.base64 contains the data URL format
          const imageUrl = file.base64.startsWith("data:")
            ? file.base64
            : `data:${file.mediaType};base64,${file.base64}`;

          console.log(
            `[ImageGen:GeminiFlash] Successfully generated image (${file.mediaType})`
          );

          return {
            success: true,
            imageUrl,
            provider: PROVIDER_NAME,
          };
        }
      }
    }

    // No image found in response
    console.log(`[ImageGen:GeminiFlash] No image found in files`);
    return {
      success: false,
      provider: PROVIDER_NAME,
      error: "No image generated in response",
      errorCode: "UNKNOWN",
    };
  } catch (error: unknown) {
    console.error(`[ImageGen:GeminiFlash] Error:`, error);

    // Check for rate limit errors
    if (isGeminiRateLimitError(error)) {
      return {
        success: false,
        provider: PROVIDER_NAME,
        error: "Gemini Flash rate limit exceeded",
        errorCode: "RATE_LIMITED",
      };
    }

    // Check for server errors (5xx)
    if (isServerError(error)) {
      return {
        success: false,
        provider: PROVIDER_NAME,
        error: `Gemini Flash server error: ${getErrorMessage(error)}`,
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
 * Check if error is a rate limit error from Gemini
 */
function isGeminiRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("429") ||
      message.includes("rate limit") ||
      message.includes("resource exhausted") ||
      message.includes("quota exceeded")
    );
  }
  if (typeof error === "object" && error !== null) {
    const anyError = error as Record<string, unknown>;
    if (anyError.status === 429) return true;
    if (anyError.code === "RESOURCE_EXHAUSTED") return true;
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
