export type CustomSizeMeasurements = Record<string, number | string | null | undefined>
export type CustomSizesPayload = Record<string, CustomSizeMeasurements | null | undefined>

export type NormalizedSizeSet = {
  size_label: string
  measurements: Record<string, number>
}

export type LegacyColorPaletteEntry = {
  name?: string | null
  code?: string | null
  hex_code?: string | null
  usage_notes?: string | null
  order?: number | null
}

export type NormalizedColor = {
  name: string
  hex_code: string
  usage_notes?: string
  order?: number
}

const normalizeMeasurementValue = (value: number | string | null | undefined): number | undefined => {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim())
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  return undefined
}

const normalizeHexCode = (value?: string | null): string | undefined => {
  if (!value) {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed.length) {
    return undefined
  }

  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`
}

export const convertCustomSizesToSizeSets = (
  customSizes?: CustomSizesPayload | null
): NormalizedSizeSet[] | undefined => {
  if (!customSizes) {
    return undefined
  }

  const normalized = Object.entries(customSizes).reduce<NormalizedSizeSet[]>((acc, [label, measurements]) => {
    if (!label || !measurements) {
      return acc
    }

    const normalizedMeasurements = Object.entries(measurements).reduce<Record<string, number>>(
      (measurementAcc, [measurementKey, measurementValue]) => {
        const normalizedValue = normalizeMeasurementValue(measurementValue)
        if (typeof normalizedValue !== "undefined") {
          measurementAcc[measurementKey] = normalizedValue
        }
        return measurementAcc
      },
      {}
    )

    if (Object.keys(normalizedMeasurements).length) {
      acc.push({
        size_label: label,
        measurements: normalizedMeasurements,
      })
    }

    return acc
  }, [])

  return normalized.length ? normalized : undefined
}

type LegacyColorPalette = LegacyColorPaletteEntry[] | Record<string, unknown>

const toLegacyColorEntry = (entry: unknown): LegacyColorPaletteEntry | undefined => {
  if (!entry || typeof entry !== "object") {
    return undefined
  }

  const record = entry as Record<string, unknown>
  const name = typeof record.name === "string" ? record.name : undefined
  const code = typeof record.code === "string" ? record.code : undefined
  const hex_code = typeof record.hex_code === "string" ? record.hex_code : undefined
  const usage_notes = typeof record.usage_notes === "string" ? record.usage_notes : undefined
  const order = typeof record.order === "number" ? record.order : undefined

  if (!name && !code && !hex_code) {
    return undefined
  }

  return {
    name,
    code,
    hex_code,
    usage_notes,
    order,
  }
}

const coercePaletteToArray = (
  palette?: LegacyColorPalette | null
): LegacyColorPaletteEntry[] | undefined => {
  if (!palette) {
    return undefined
  }

  if (Array.isArray(palette)) {
    return palette.map((entry) => toLegacyColorEntry(entry)).filter(
      (entry): entry is LegacyColorPaletteEntry => Boolean(entry)
    )
  }

  if (typeof palette === "object") {
    return Object.values(palette)
      .map((entry) => toLegacyColorEntry(entry))
      .filter((entry): entry is LegacyColorPaletteEntry => Boolean(entry))
  }

  return undefined
}

export const convertColorPaletteToColors = (
  palette?: LegacyColorPalette | null
): NormalizedColor[] | undefined => {
  const normalizedPalette = coercePaletteToArray(palette)
  if (!normalizedPalette?.length) {
    return undefined
  }

  const normalized = normalizedPalette.reduce<NormalizedColor[]>((acc, entry) => {
    const name = entry.name?.trim()
    const hexCode = normalizeHexCode(entry.hex_code ?? entry.code)

    if (name && hexCode) {
      acc.push({
        name,
        hex_code: hexCode,
        usage_notes: entry.usage_notes ?? undefined,
        order: typeof entry.order === "number" ? entry.order : undefined,
      })
    }

    return acc
  }, [])

  return normalized.length ? normalized : undefined
}
