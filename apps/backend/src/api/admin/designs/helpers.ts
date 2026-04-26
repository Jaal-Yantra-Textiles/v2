

import { Design } from "./validators"
import { MedusaContainer } from "@medusajs/framework"

type HydratedDesign = Record<string, any> & {
  colors?: any[]
  size_sets?: any[]
  inventory_items?: any[]
}

export type DesignAllowedFields =
  | "*"
  | keyof Design
  | "colors.*"
  | "size_sets.*"
  | "inventory_items.*"

export const refetchDesign = async (
  designId: string,
  container: MedusaContainer,
  fields: DesignAllowedFields[] = ["*"]
) => {
  const query = container.resolve("query")

  const baseFields: DesignAllowedFields[] = [
    "colors.*",
    "size_sets.*",
    "inventory_items.*",
  ]
  const requested = new Set<DesignAllowedFields>([...fields, ...baseFields])

  const { data: design } = await query.graph({
    entity: "designs",
    filters: {
      id: designId,
    },
    fields: Array.from(requested),
  })

  const rawRecord = design?.[0]
  if (!rawRecord) {
    return rawRecord
  }

  const normalizedInventoryItems = Array.isArray(rawRecord.inventory_items)
    ? rawRecord.inventory_items.filter(Boolean)
    : rawRecord.inventory_items
    ? [rawRecord.inventory_items]
    : undefined

  const record: HydratedDesign = {
    ...rawRecord,
    inventory_items: normalizedInventoryItems,
  }

  const structuredColors = record.colors
  if ((!record.color_palette || !record.color_palette.length) && Array.isArray(structuredColors)) {
    ;(record as any).color_palette = structuredColors.map((color) => ({
      name: color.name,
      code: color.hex_code,
    }))
  }

  const structuredSizeSets = record.size_sets
  if (!record.custom_sizes && Array.isArray(structuredSizeSets)) {
    const sizeMap: Record<string, Record<string, number>> = {}
    for (const size of structuredSizeSets) {
      sizeMap[size.size_label] = size.measurements || {}
    }
    ;(record as any).custom_sizes = sizeMap
  }

  if (Array.isArray(record.inventory_items)) {
    record.inventory_items = record.inventory_items.map((item) => ({
      ...item,
      metadata: item?.metadata || {},
    }))
  }

  return record
}
