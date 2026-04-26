/**
 * SKU auto-generation utility for raw material inventory items.
 *
 * Format: {CATEGORY}-{MATERIAL_ABBR}-{COLOR_ABBR}-{SEQ}
 * Example: FAB-COT-BLU-001
 */

const CATEGORY_PREFIX: Record<string, string> = {
  Fabric: "FAB",
  Fiber: "FIB",
  Yarn: "YRN",
  Trim: "TRIM",
  Dye: "DYE",
  Chemical: "CHEM",
  Accessory: "ACC",
  Other: "OTH",
}

/**
 * Abbreviate a string to its first 3 uppercase characters.
 * Strips non-alpha characters before abbreviating.
 */
function abbreviate(value: string, length = 3): string {
  return value
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, length)
    .toUpperCase()
}

/**
 * Build a SKU prefix from category, material name, and optional color.
 *
 * @example buildSkuPrefix("Fabric", "Cotton", "Blue") => "FAB-COT-BLU"
 * @example buildSkuPrefix("Yarn", "Silk")             => "YRN-SIL"
 */
export function buildSkuPrefix(
  category: string,
  materialName: string,
  color?: string | null
): string {
  const catPrefix = CATEGORY_PREFIX[category] || "OTH"
  const matAbbr = abbreviate(materialName)

  const parts = [catPrefix, matAbbr]
  if (color) {
    parts.push(abbreviate(color))
  }

  return parts.join("-")
}

/**
 * Format a full SKU with zero-padded sequence number.
 *
 * @example formatSku("FAB-COT-BLU", 1) => "FAB-COT-BLU-001"
 */
export function formatSku(prefix: string, sequenceNumber: number): string {
  return `${prefix}-${String(sequenceNumber).padStart(3, "0")}`
}

/**
 * Extract the next sequence number from a list of existing SKUs that share a prefix.
 */
export function nextSequenceNumber(existingSkus: string[], prefix: string): number {
  let max = 0
  const re = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`)

  for (const sku of existingSkus) {
    const match = sku.match(re)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > max) max = num
    }
  }

  return max + 1
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
