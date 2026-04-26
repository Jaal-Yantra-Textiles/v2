/**
 * Mistral FLUX1.1 Provider
 *
 * Uses Mastra Agent's generate method with image_generation tool
 * Model: mistral-medium-latest (text model with image generation capability)
 *
 * Mistral is a text model that can generate images via the built-in
 * image_generation tool through their Conversations/Agents API.
 *
 * @see https://docs.mistral.ai/agents/tools/built-in/image_generation
 */

// @ts-nocheck 
import { Agent } from "@mastra/core/agent";
import { GenerationResult } from "./index";

const PROVIDER_NAME = "mistral" as const;

/**
 * Generate an image using Mistral's text model with image_generation tool
 *
 * Uses Mastra's Agent.generate() which will route through the appropriate API.
 *
 * @param prompt - The text prompt for image generation
 * @returns GenerationResult with base64 data URL on success
 */
export async function generateWithMistralFlux(
  prompt: string
): Promise<GenerationResult> {
  try {
    console.log(`[ImageGen:Mistral] Generating image via Mastra Agent...`);
    console.log(`[ImageGen:Mistral] Prompt: ${prompt.substring(0, 100)}...`);

    // Create agent with image_generation tool
    const imageGeneratorAgent = new Agent({
      name: "mistral-image-gen",
      model: "mistral/mistral-medium-latest",
      instructions:
        "You are a fashion design image generator. Generate high-quality fashion design images based on the provided prompt. Always use the image_generation tool to create the image.",
        tools: ['image_generation']
    });

    // Generate with the agent
    const response = await imageGeneratorAgent.generate(
      
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `You are to produce an image using ${prompt}`
            },
            
          ],
        },
      
    );

    console.log(`[ImageGen:Mistral] Agent response received`, JSON.stringify(response, null, 2));
    console.log(
      `[ImageGen:Mistral] Tool calls:`,
      JSON.stringify(response.toolCalls, null, 2)
    );
    console.log(
      `[ImageGen:Mistral] Tool results:`,
      JSON.stringify(response.toolResults, null, 2)
    );

    // Extract image URL from tool results
    let imageUrl: string | undefined;

    if (response.toolResults && response.toolResults.length > 0) {
      for (const result of response.toolResults) {
        const toolResult = result.result as {
          imageUrl?: string;
          error?: string;
        };
        if (toolResult?.imageUrl) {
          imageUrl = toolResult.imageUrl;
          break;
        }
      }
    }

    if (imageUrl) {
      console.log(`[ImageGen:Mistral] Successfully generated image via Agent`);
      return {
        success: true,
        imageUrl,
        provider: PROVIDER_NAME,
      };
    }

    // No image found in response
    console.log(`[ImageGen:Mistral] No image URL found in tool results`);
    return {
      success: false,
      provider: PROVIDER_NAME,
      error: "No image generated in response",
      errorCode: "UNKNOWN",
    };
  } catch (error: unknown) {
    console.error(`[ImageGen:Mistral] Error:`, error);

    // Check for rate limit errors
    if (isMistralRateLimitError(error)) {
      return {
        success: false,
        provider: PROVIDER_NAME,
        error: "Mistral rate limit exceeded",
        errorCode: "RATE_LIMITED",
      };
    }

    // Check for server errors (5xx)
    if (isServerError(error)) {
      return {
        success: false,
        provider: PROVIDER_NAME,
        error: `Mistral server error: ${getErrorMessage(error)}`,
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
 * Check if error is a rate limit error from Mistral
 */
function isMistralRateLimitError(error: unknown): boolean {
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
