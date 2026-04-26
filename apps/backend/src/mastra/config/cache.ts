// @ts-nocheck
/**
 * Shared cache configuration for catalog and workflow systems.
 * 
 * Previously, the catalog route used a 6-hour TTL while the workflow
 * used a 5-minute TTL, causing inconsistent cache behavior.
 * 
 * This module provides a single source of truth for cache settings.
 */

export const CATALOG_CACHE_CONFIG = {
    /**
     * Time-to-live for catalog cache entries.
     * Balanced between freshness and performance.
     */
    TTL_MS: 30 * 60 * 1000, // 30 minutes

    /**
     * Optional: Background refresh interval.
     * Can be used for proactive cache warming.
     */
    REFRESH_INTERVAL: 15 * 60 * 1000, // 15 minutes
} as const
