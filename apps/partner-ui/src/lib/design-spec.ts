/**
 * Pure readers for a design's specification block (#2019).
 *
 * Extracted from `design-detail.tsx`, where they sat inline in a 625-line
 * page — the one part of the design manager the order context could not
 * reuse, because it was not a component.
 */

export type DesignSize = { label: string; measurements: unknown }

/**
 * The sizes to show, from either source.
 *
 * 🔑 `size_sets` WINS, and `custom_sizes` is only consulted when there are
 * none — they are two generations of the same field, not two halves of one
 * list. Merging them would double every size on a design that has been
 * migrated, which is most of them.
 */
export const deriveDesignSizes = (
  sizeSets: Array<{ size_label?: string | null; measurements?: unknown }> | null | undefined,
  customSizes: Record<string, unknown> | null | undefined
): DesignSize[] => {
  if (Array.isArray(sizeSets) && sizeSets.length > 0) {
    return sizeSets
      .filter((s) => s?.size_label)
      .map((s) => ({ label: String(s!.size_label), measurements: s?.measurements }))
  }
  if (customSizes && typeof customSizes === "object" && !Array.isArray(customSizes)) {
    return Object.entries(customSizes).map(([label, measurements]) => ({
      label,
      measurements,
    }))
  }
  return []
}

export type DesignColor = { name: string; value: string }

/**
 * Normalize whatever `color_palette` holds into swatches.
 *
 * The column has carried at least four shapes over its life — an array of
 * strings, an array of `{name, hex|value|code}`, and an object keyed by name.
 * The renderer used to unpick all of them inline, which is why the same
 * three-way `||` fallback appeared twice in one expression.
 *
 * A swatch with no usable colour is dropped rather than rendered as a
 * transparent circle with a label: an invisible swatch reads as a rendering
 * bug, not as missing data.
 */
export const normalizeColorPalette = (
  palette: unknown
): DesignColor[] => {
  if (!palette || typeof palette !== "object") {
    return []
  }

  const entries: unknown[] = Array.isArray(palette)
    ? palette
    : Object.entries(palette as Record<string, unknown>).map(([name, value]) => ({
        name,
        value,
      }))

  const out: DesignColor[] = []
  for (const color of entries) {
    if (typeof color === "string") {
      if (color.trim()) {
        out.push({ name: color, value: color })
      }
      continue
    }
    if (!color || typeof color !== "object") {
      continue
    }
    const c = color as Record<string, any>
    const value = c.hex || c.value || c.code
    if (typeof value !== "string" || !value.trim()) {
      continue
    }
    out.push({ name: String(c.name || value), value })
  }
  return out
}
