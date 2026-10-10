/**
 * Deep merge two themes — incoming values override existing,
 * but sections not present in incoming are preserved.
 *
 * Shared by the partner theme route and the admin one (#2061), so an operator
 * editing a partner's storefront merges exactly as the partner's editor does.
 */
export function deepMergeTheme(
  existing: Record<string, any>,
  incoming: Record<string, any>
): Record<string, any> {
  const result = { ...existing }

  for (const key of Object.keys(incoming)) {
    const existingVal = existing[key]
    const incomingVal = incoming[key]

    if (
      incomingVal &&
      typeof incomingVal === "object" &&
      !Array.isArray(incomingVal) &&
      existingVal &&
      typeof existingVal === "object" &&
      !Array.isArray(existingVal)
    ) {
      // Merge nested objects (e.g. hero, colors, animations)
      result[key] = { ...existingVal, ...incomingVal }
    } else {
      // Primitives, arrays, or null — take incoming value
      result[key] = incomingVal
    }
  }

  return result
}
