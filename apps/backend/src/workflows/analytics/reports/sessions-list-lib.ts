/**
 * Sessions List helpers (#569 S7a)
 *
 * Pure, framework-free helpers for the paginated sessions list endpoint
 * (`GET /admin/websites/:id/analytics/sessions`). Keeping pagination /
 * ordering sanitisation here makes it unit-testable without booting Medusa.
 */

export const DEFAULT_SESSION_LIMIT = 20;
export const MAX_SESSION_LIMIT = 100;

/** Columns a caller may order the sessions list by. */
export const SESSION_ORDER_FIELDS = [
  "started_at",
  "last_activity_at",
  "ended_at",
  "duration_seconds",
  "pageviews",
] as const;

export type SessionOrderField = (typeof SESSION_ORDER_FIELDS)[number];
export type SessionOrderDir = "ASC" | "DESC";

/** Columns selected for each returned session row. */
export const SESSION_SELECT = [
  "id",
  "session_id",
  "visitor_id",
  "entry_page",
  "exit_page",
  "pageviews",
  "duration_seconds",
  "is_bounce",
  "referrer",
  "referrer_source",
  "country",
  "device_type",
  "browser",
  "os",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "started_at",
  "ended_at",
  "last_activity_at",
] as const;

export function isSessionOrderField(value: unknown): value is SessionOrderField {
  return (
    typeof value === "string" &&
    (SESSION_ORDER_FIELDS as readonly string[]).includes(value)
  );
}

/**
 * Clamp a requested page size into [1, MAX_SESSION_LIMIT].
 * Missing / non-numeric / <=0 → DEFAULT_SESSION_LIMIT; over the cap → cap.
 */
export function resolveLimit(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SESSION_LIMIT;
  return Math.min(n, MAX_SESSION_LIMIT);
}

/** Clamp a requested offset to a non-negative integer (default 0). */
export function resolveOffset(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/** Normalise an order direction; default DESC. */
export function resolveOrderDir(raw: unknown): SessionOrderDir {
  if (typeof raw === "string" && raw.toUpperCase() === "ASC") return "ASC";
  return "DESC";
}

export type SessionListParamsInput = {
  limit?: unknown;
  offset?: unknown;
  order_by?: unknown;
  order_dir?: unknown;
};

export type ResolvedSessionListParams = {
  take: number;
  skip: number;
  order: Record<SessionOrderField, SessionOrderDir>;
};

/**
 * Resolve raw query params into a safe `listAndCount` options object:
 * clamped take/skip and a whitelisted single-column order map.
 */
export function resolveSessionListParams(
  input: SessionListParamsInput = {}
): ResolvedSessionListParams {
  const field: SessionOrderField = isSessionOrderField(input.order_by)
    ? input.order_by
    : "started_at";
  const dir = resolveOrderDir(input.order_dir);

  return {
    take: resolveLimit(input.limit),
    skip: resolveOffset(input.offset),
    order: { [field]: dir } as Record<SessionOrderField, SessionOrderDir>,
  };
}
