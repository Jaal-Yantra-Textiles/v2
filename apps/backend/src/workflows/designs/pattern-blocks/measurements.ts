/**
 * Measurement resolution for FreeSewing pattern-block drafting.
 *
 * A design's `DesignSizeSet.measurements` only holds a handful of keys (typically
 * chest / waist / hip) in INCHES, but every FreeSewing block needs its full
 * per-design measurement set (12-25 keys) in MILLIMETRES — a missing key makes the
 * block draft *empty* with no error. We therefore start from the closest standard
 * FreeSewing model size (a complete mm set) and override the keys the design provides.
 *
 * FreeSewing is ESM-only + untyped; it is loaded via dynamic `import()` (the backend
 * is CommonJS — see segment/route.ts using the same pattern for @fal-ai/client).
 */

export type MeasurementUnit = "in" | "cm"

const IN_TO_MM = 25.4
const CM_TO_MM = 10

/**
 * Maps a design size-set key (lowercased) to one or more FreeSewing canonical keys.
 * `hip` feeds both `hips` (bodice/skirt) and `seat` (trouser/skirt).
 */
const KEY_ALIAS: Record<string, string[]> = {
  chest: ["chest"],
  bust: ["chest"],
  waist: ["waist"],
  hip: ["hips", "seat"],
  hips: ["hips", "seat"],
  seat: ["seat", "hips"],
  neck: ["neck"],
  inseam: ["inseam"],
  shoulder: ["shoulderToShoulder"],
  shouldertoshoulder: ["shoulderToShoulder"],
}

/** Standard female-adult model size groups exported by @freesewing/models. */
const BASE_MODEL_GROUP = "cisFemaleAdult"
const BASE_MODEL_FALLBACK = "cisFemaleAdult36"

function pickBaseByChest(
  models: Record<string, any>,
  chestMm?: number
): Record<string, number> {
  const group = models[BASE_MODEL_GROUP] as Record<string, Record<string, number>> | undefined
  if (!group) return { ...(models[BASE_MODEL_FALLBACK] ?? {}) }
  if (!chestMm) return { ...(group["36"] ?? models[BASE_MODEL_FALLBACK] ?? {}) }
  let best: Record<string, number> | undefined
  let bestDelta = Infinity
  for (const size of Object.values(group)) {
    if (typeof size?.chest !== "number") continue
    const delta = Math.abs(size.chest - chestMm)
    if (delta < bestDelta) {
      bestDelta = delta
      best = size
    }
  }
  return { ...(best ?? group["36"] ?? {}) }
}

/**
 * Resolve a design size set into a complete FreeSewing measurement set (mm).
 * Unmapped/non-numeric keys are ignored; every returned block-required key is
 * guaranteed present because the standard base model backfills the rest.
 */
export async function resolveMeasurements(
  sizeSetMeasurements: Record<string, number> | null | undefined,
  unit: MeasurementUnit = "in"
): Promise<Record<string, number>> {
  const models = await import("@freesewing/models")
  const factor = unit === "cm" ? CM_TO_MM : IN_TO_MM

  const provided: Record<string, number> = {}
  for (const [rawKey, rawVal] of Object.entries(sizeSetMeasurements ?? {})) {
    if (typeof rawVal !== "number" || !isFinite(rawVal)) continue
    const targets = KEY_ALIAS[rawKey.trim().toLowerCase()]
    if (!targets) continue
    for (const target of targets) provided[target] = rawVal * factor
  }

  const base = pickBaseByChest(models as any, provided.chest)
  return { ...base, ...provided }
}
