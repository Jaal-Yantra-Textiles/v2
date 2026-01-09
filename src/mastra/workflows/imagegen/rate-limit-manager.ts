/**
 * Rate Limit Manager
 *
 * In-memory rate limit tracking for AI image generation providers.
 * Tracks request counts per sliding window and cooldown periods after 429 errors.
 *
 * This enables proactive provider skipping to avoid unnecessary API calls
 * when a provider is known to be rate-limited.
 */

import { ImageProvider } from "./providers";

type RateLimitConfig = {
  maxRequests: number;
  windowDurationMs: number;
  cooldownMs: number;
};

type RateLimitState = {
  requestTimestamps: number[];
  isBlocked: boolean;
  blockedUntil?: number;
  lastError?: string;
};

/**
 * Rate limit configuration per provider
 * Conservative estimates to stay under limits
 */
const RATE_LIMITS: Record<ImageProvider, RateLimitConfig> = {
  google: {
    maxRequests: 50, // Conservative estimate for Imagen
    windowDurationMs: 60000, // 1 minute window
    cooldownMs: 60000, // 1 minute cooldown on 429
  },
  "gemini-flash": {
    maxRequests: 30, // Conservative estimate for Gemini Flash
    windowDurationMs: 60000, // 1 minute window
    cooldownMs: 60000, // 1 minute cooldown on 429
  },
  mistral: {
    maxRequests: 10, // Based on image_generation limits
    windowDurationMs: 60000, // 1 minute window
    cooldownMs: 60000, // 1 minute cooldown on 429
  },
  fireworks: {
    maxRequests: 20, // Conservative estimate for Fireworks
    windowDurationMs: 60000, // 1 minute window
    cooldownMs: 60000, // 1 minute cooldown on 429
  },
};

/**
 * In-memory state for each provider
 */
const providerState: Map<ImageProvider, RateLimitState> = new Map();

/**
 * Initialize state for a provider if not exists
 */
function ensureState(provider: ImageProvider): RateLimitState {
  if (!providerState.has(provider)) {
    providerState.set(provider, {
      requestTimestamps: [],
      isBlocked: false,
    });
  }
  return providerState.get(provider)!;
}

/**
 * Clean up old timestamps outside the sliding window
 */
function cleanupTimestamps(state: RateLimitState, windowDurationMs: number): void {
  const now = Date.now();
  const cutoff = now - windowDurationMs;
  state.requestTimestamps = state.requestTimestamps.filter((ts) => ts > cutoff);
}

/**
 * Check if a provider can be used (not rate-limited)
 *
 * @param provider - The provider to check
 * @returns true if provider is available, false if rate-limited
 */
export function canUseProvider(provider: ImageProvider): boolean {
  const state = ensureState(provider);
  const config = RATE_LIMITS[provider];
  const now = Date.now();

  // Check if blocked due to 429 error
  if (state.isBlocked) {
    if (state.blockedUntil && now >= state.blockedUntil) {
      // Cooldown expired, unblock
      state.isBlocked = false;
      state.blockedUntil = undefined;
      state.lastError = undefined;
      console.log(`[RateLimit] ${provider} cooldown expired, unblocking`);
    } else {
      const remainingMs = state.blockedUntil
        ? state.blockedUntil - now
        : config.cooldownMs;
      console.log(
        `[RateLimit] ${provider} blocked for ${Math.ceil(remainingMs / 1000)}s more`
      );
      return false;
    }
  }

  // Clean up old timestamps and check window limit
  cleanupTimestamps(state, config.windowDurationMs);

  if (state.requestTimestamps.length >= config.maxRequests) {
    console.log(
      `[RateLimit] ${provider} at window limit (${state.requestTimestamps.length}/${config.maxRequests})`
    );
    return false;
  }

  return true;
}

/**
 * Record a successful request to a provider
 *
 * @param provider - The provider that was used
 */
export function recordRequest(provider: ImageProvider): void {
  const state = ensureState(provider);
  state.requestTimestamps.push(Date.now());
  console.log(
    `[RateLimit] ${provider} request recorded (${state.requestTimestamps.length} in window)`
  );
}

/**
 * Record a rate limit hit (429 error) for a provider
 *
 * @param provider - The provider that hit rate limit
 * @param retryAfterMs - Optional retry-after duration in milliseconds
 */
export function recordRateLimitHit(
  provider: ImageProvider,
  retryAfterMs?: number
): void {
  const state = ensureState(provider);
  const config = RATE_LIMITS[provider];
  const cooldown = retryAfterMs || config.cooldownMs;

  state.isBlocked = true;
  state.blockedUntil = Date.now() + cooldown;
  state.lastError = `Rate limited at ${new Date().toISOString()}`;

  console.log(
    `[RateLimit] ${provider} blocked for ${cooldown / 1000}s due to rate limit`
  );
}

/**
 * Get the next available provider in priority order
 *
 * @param providers - Array of providers in priority order
 * @returns The first available provider, or null if all are rate-limited
 */
export function getNextAvailableProvider(
  providers: ImageProvider[]
): ImageProvider | null {
  for (const provider of providers) {
    if (canUseProvider(provider)) {
      return provider;
    }
  }
  return null;
}

/**
 * Get the current status of all providers
 *
 * @returns Status object for each provider
 */
export function getProviderStatus(): Record<
  ImageProvider,
  {
    available: boolean;
    requestsInWindow: number;
    maxRequests: number;
    blockedUntil?: Date;
  }
> {
  const result: Record<
    ImageProvider,
    {
      available: boolean;
      requestsInWindow: number;
      maxRequests: number;
      blockedUntil?: Date;
    }
  > = {} as any;

  const allProviders: ImageProvider[] = ["google", "gemini-flash", "mistral", "fireworks"];

  for (const provider of allProviders) {
    const state = ensureState(provider);
    const config = RATE_LIMITS[provider];

    cleanupTimestamps(state, config.windowDurationMs);

    result[provider] = {
      available: canUseProvider(provider),
      requestsInWindow: state.requestTimestamps.length,
      maxRequests: config.maxRequests,
      blockedUntil: state.blockedUntil ? new Date(state.blockedUntil) : undefined,
    };
  }

  return result;
}

/**
 * Reset rate limit state for a provider (for testing)
 *
 * @param provider - The provider to reset
 */
export function resetProvider(provider: ImageProvider): void {
  providerState.set(provider, {
    requestTimestamps: [],
    isBlocked: false,
  });
  console.log(`[RateLimit] ${provider} state reset`);
}

/**
 * Reset all provider states (for testing)
 */
export function resetAllProviders(): void {
  providerState.clear();
  console.log(`[RateLimit] All provider states reset`);
}
