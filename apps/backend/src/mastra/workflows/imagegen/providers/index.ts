/**
 * Multi-Provider Image Generation System
 *
 * Provides a unified interface for multiple AI image generation providers
 * with automatic rate limit tracking and fallback capabilities.
 *
 * Provider Types:
 * - Image Models: Dedicated image generation (Google Imagen)
 * - Text Models with Image Output: Multi-modal text models that can generate images
 *   (Gemini Flash, Mistral, Fireworks)
 *
 * Provider Priority: Google Imagen → Gemini Flash → Mistral → Fireworks → Out of credits
 */

export type ImageProvider = "google" | "gemini-flash" | "mistral" | "fireworks";

export type ProviderStatus = {
  available: boolean;
  rateLimitRemaining?: number;
  rateLimitResetAt?: Date;
  lastError?: string;
};

export type GenerationResult = {
  success: boolean;
  imageUrl?: string;
  provider: ImageProvider;
  error?: string;
  errorCode?: "RATE_LIMITED" | "SERVER_ERROR" | "NETWORK_ERROR" | "UNKNOWN";
};

export type ProviderGenerateFunction = (
  prompt: string
) => Promise<GenerationResult>;

export interface ImageProviderModule {
  name: ImageProvider;
  generate: ProviderGenerateFunction;
}

/**
 * Provider priority order for image generation
 * First provider that succeeds wins, rate-limited providers are skipped
 *
 * TODO: Revert to ["google", "gemini-flash", "mistral", "fireworks"] after testing
 */
export const PROVIDER_PRIORITY: ImageProvider[] = [
  "mistral",
  "gemini-flash",
  "google",
  "fireworks",
];

/**
 * Check if an error indicates a rate limit (429)
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("429") ||
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("quota exceeded")
    );
  }
  if (typeof error === "object" && error !== null) {
    const anyError = error as Record<string, unknown>;
    if (anyError.status === 429) return true;
    if (typeof anyError.detail === "string") {
      return anyError.detail.toLowerCase().includes("rate limit");
    }
  }
  return false;
}

/**
 * Extract retry-after header value in milliseconds
 */
export function extractRetryAfterMs(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const anyError = error as Record<string, unknown>;
    // Check for retry-after in headers
    if (typeof anyError.retryAfter === "number") {
      return anyError.retryAfter * 1000;
    }
    if (typeof anyError.retryAfter === "string") {
      const seconds = parseInt(anyError.retryAfter, 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }
  }
  // Default cooldown: 60 seconds
  return 60000;
}
