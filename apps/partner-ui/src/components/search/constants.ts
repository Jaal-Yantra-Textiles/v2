export const SEARCH_AREAS = [
  "all",
  "command",
  "navigation",
  "orders",
  "designs",
  "inventory",
  "customers",
] as const

// Data-entity areas (subset of SEARCH_AREAS) that fan out to the partner APIs.
export const DATA_SEARCH_AREAS = [
  "orders",
  "designs",
  "inventory",
  "customers",
] as const

export const DEFAULT_SEARCH_LIMIT = 3
export const SEARCH_LIMIT_INCREMENT = 20
