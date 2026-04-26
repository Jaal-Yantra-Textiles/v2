import { MedusaContainer } from "@medusajs/framework/types"
import { RAW_MATERIAL_MODULE } from "../../../../../modules/raw_material"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { RawMaterial } from "./validators"
import RawMaterialInventoryLink from "../../../../../links/raw-material-data-inventory"

export type RawMaterialAllowedFields = "*" | keyof RawMaterial

export const refetchRawMaterial = async (
  id: string,
  container: MedusaContainer,
  fields: RawMaterialAllowedFields[] = ["*"]
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: inventoryItem } = await query.graph({
    entity: "inventory_item",
    filters: { id },
    fields: [
      "*",
      "raw_materials.*",
    ],
  })

  if (!inventoryItem?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw Material with id "${id}" not found`
    )
  }

  return inventoryItem[0]
}

export const getAllInventoryWithRawMaterial = async (
  container: MedusaContainer,
  filters: Record<string, unknown> = {},
  fields: RawMaterialAllowedFields[] = ["*"]
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Debug: incoming filters
  // Note: In Medusa v2, query.graph cannot filter on linked entity properties.
  // We'll split filters into link-level (safe) and nested (post-filter in app code).
  // Safe link fields (from RawMaterialInventoryLink): id, inventory_item_id, raw_materials_id, created_at, updated_at, deleted_at
  const incoming = filters || {}
  const { q, ...rest } = incoming as Record<string, any>
  const safeKeys = new Set(["id", "inventory_item_id", "raw_materials_id", "created_at", "updated_at", "deleted_at"])
  const apiFilters: Record<string, unknown> = {}
  const postFilters: Record<string, unknown> = {}

  Object.entries(rest).forEach(([k, v]) => {
    if (safeKeys.has(k)) {
      apiFilters[k] = v
    } else {
      // Treat everything else as a nested filter to apply after retrieval
      postFilters[k] = v
    }
  })

  console.log("[getAllInventoryWithRawMaterial] incoming filters:", incoming)
  console.log("[getAllInventoryWithRawMaterial] apiFilters (applied in query.graph):", apiFilters)
  console.log("[getAllInventoryWithRawMaterial] postFilters (applied in app):", postFilters, "q:", q)

  const { data } = await query.graph({
    entity: RawMaterialInventoryLink.entryPoint,
    fields: ["*", "raw_materials.*", "inventory_item.*"],
    // Only pass safe link-level filters to the graph query
    filters: apiFilters
  })

  const items = Array.isArray(data) ? data : []
  console.log("[getAllInventoryWithRawMaterial] fetched count:", items.length)

  // Apply q search against common text fields from linked entities
  const applyQ = (list: any[], queryStr?: unknown) => {
    if (typeof queryStr !== "string" || !queryStr.trim()) return list
    const needle = queryStr.toLowerCase()
    return list.filter((row) => {
      const raw = row?.raw_materials || {}
      const inv = row?.inventory_item || {}
      const candidates: Array<string | undefined> = [raw.name, inv.title, inv.sku]
      return candidates.some((c) => c && c.toLowerCase().includes(needle))
    })
  }

  // Apply nested post-filters like "raw_materials.name" or "inventory_item.sku"
  const applyPostFilters = (list: any[], pf: Record<string, unknown>) => {
    const entries = Object.entries(pf)
    if (!entries.length) return list
    const getByPath = (obj: any, path: string) => {
      return path.split(".").reduce((acc, key) => (acc ? acc[key] : undefined), obj)
    }
    return list.filter((row) => {
      return entries.every(([path, expected]) => {
        const val = getByPath(row, path)
        if (expected == null) return val == null
        if (typeof expected === "string") {
          // case-insensitive contains match for strings
          return typeof val === "string" && val.toLowerCase().includes(expected.toLowerCase())
        }
        // strict equality for non-strings
        return val === expected
      })
    })
  }

  let result = items
  const beforeQ = result.length
  result = applyQ(result, q)
  if (beforeQ !== result.length) {
    console.log(`[getAllInventoryWithRawMaterial] q filter applied: ${beforeQ} -> ${result.length}`)
  }

  const beforePost = result.length
  result = applyPostFilters(result, postFilters)
  if (beforePost !== result.length) {
    console.log(`[getAllInventoryWithRawMaterial] postFilters applied: ${beforePost} -> ${result.length}`)
  }

  return result
}