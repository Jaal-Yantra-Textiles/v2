import { FetchError } from "@medusajs/js-sdk"

/**
 * Extract a human-readable error message from any error shape.
 * Handles: FetchError, Medusa API errors, plain Error, string, unknown.
 */
export function extractErrorMessage(
  error: unknown,
  fallback = "An unexpected error occurred"
): string {
  if (!error) return fallback

  // FetchError from @medusajs/js-sdk
  if (error instanceof FetchError) {
    // The body may contain structured error data
    const body = (error as any).body
    if (body) {
      // Medusa standard: { message: "..." }
      if (typeof body.message === "string" && body.message) {
        return body.message
      }
      // Medusa validation: { errors: [{ message: "..." }] }
      if (Array.isArray(body.errors) && body.errors.length) {
        return body.errors
          .map((e: any) => e.message || e.detail || String(e))
          .join(". ")
      }
      // Zod-style: { issues: [{ message: "..." }] }
      if (Array.isArray(body.issues) && body.issues.length) {
        return body.issues.map((i: any) => i.message).join(". ")
      }
    }
    // Fall back to FetchError.message
    if (error.message && error.message !== "fetch failed") {
      return error.message
    }
    // Status-based fallback
    const status = (error as any).status
    if (status === 401) return "You are not authorized to perform this action"
    if (status === 403) return "You don't have permission for this action"
    if (status === 404) return "The requested resource was not found"
    if (status === 409) return "This conflicts with existing data"
    if (status === 422) return "The submitted data is invalid"
    if (status === 429) return "Too many requests — please try again later"
    if (status >= 500) return "Server error — please try again later"
    return fallback
  }

  // Plain Error
  if (error instanceof Error) {
    if (error.message === "fetch failed" || error.message === "Failed to fetch") {
      return "Network error — check your connection and try again"
    }
    return error.message || fallback
  }

  // String
  if (typeof error === "string") {
    return error
  }

  // Object with message
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, any>
    if (typeof obj.message === "string") return obj.message
    if (typeof obj.error === "string") return obj.error
  }

  return fallback
}
