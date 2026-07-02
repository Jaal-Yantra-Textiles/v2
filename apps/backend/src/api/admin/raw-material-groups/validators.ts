import { z } from "@medusajs/framework/zod"
import {
  INVENTORY_ORDER_STATUS_INPUT,
  type InventoryOrderInputStatus,
} from "../../../modules/inventory_orders/constants"

const UNIT_OF_MEASURE = [
  "Meter",
  "Yard",
  "Kilogram",
  "Gram",
  "Piece",
  "Roll",
  "Other",
] as const

const GROUP_STATUS = [
  "Active",
  "Discontinued",
  "Under_Review",
  "Development",
] as const

// --- Group CRUD ---

// Operator-defined variant axes a group varies its members along. `color` is the
// built-in axis and never needs declaring here; `dimensions` is additive room
// for extra axes (finish, pattern, size, …) — see raw_material_group.dimensions.
const groupDimensionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  values: z.array(z.string()).optional(),
})

// #829 — global specs the group holds once; new colors inherit these fill-blank.
const groupGlobalsShape = {
  composition: z.string().optional(),
  specifications: z.record(z.string(), z.unknown()).optional(),
  dimensions: z.array(groupDimensionSchema).optional(),
  unit_of_measure: z.enum(UNIT_OF_MEASURE).optional(),
  material_type_id: z.string().optional(),
  // A category NAME (find-or-create); resolved to material_type_id server-side.
  material_type: z.string().optional(),
  unit_cost: z.number().optional(),
  cost_currency: z.string().optional(),
  lead_time_days: z.number().int().optional(),
  minimum_order_quantity: z.number().int().optional(),
  stock_location_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  media: z.record(z.string(), z.unknown()).optional(),
}

export const createRawMaterialGroupSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  status: z.enum(GROUP_STATUS).optional(),
  ...groupGlobalsShape,
})
export type CreateRawMaterialGroup = z.infer<typeof createRawMaterialGroupSchema>

// Update a group's fields (all optional). Reuses the globals + name/desc/status.
export const updateRawMaterialGroupSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  status: z.enum(GROUP_STATUS).optional(),
  ...groupGlobalsShape,
})
export type UpdateRawMaterialGroup = z.infer<typeof updateRawMaterialGroupSchema>

export const listRawMaterialGroupsQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(GROUP_STATUS).optional(),
  offset: z.preprocess(
    (v) => (v !== undefined && v !== null ? Number(v) : undefined),
    z.number().int().min(0).default(0)
  ),
  limit: z.preprocess(
    (v) => (v !== undefined && v !== null ? Number(v) : undefined),
    z.number().int().min(1).max(100).default(20)
  ),
})
export type ListRawMaterialGroupsQuery = z.infer<typeof listRawMaterialGroupsQuerySchema>

// --- Add a color (per-color raw_material) to a group ---

export const addGroupColorSchema = z.object({
  name: z.string().min(1, "Name is required"),
  color: z.string().min(1, "Color is required"),
  description: z.string().optional(),
  composition: z.string().optional(),
  specifications: z.record(z.string(), z.unknown()).optional(),
  unit_of_measure: z.enum(UNIT_OF_MEASURE).optional(),
  material_type_id: z.string().optional(),
  unit_cost: z.number().optional(),
  cost_currency: z.string().optional(),
  lead_time_days: z.number().int().optional(),
  minimum_order_quantity: z.number().int().optional(),
  // Per-member variant coordinates keyed by the group's `dimensions`
  // (e.g. { color: "Blue", finish: "Matte" }). `color` above stays canonical.
  attributes: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  media: z.record(z.string(), z.unknown()).optional(),
})
export type AddGroupColor = z.infer<typeof addGroupColorSchema>

// Full-detail color add: accepts the same `rawMaterialData` envelope the shared
// RawMaterialForm submits (createRawMaterialWorkflow validates the shape), so a
// color can be created with all material specs. `color` is required for a variant.
export const addGroupColorFullSchema = z.object({
  rawMaterialData: z
    .object({ color: z.string().min(1, "Color is required") })
    .passthrough(),
})
export type AddGroupColorFull = z.infer<typeof addGroupColorFullSchema>

// Link existing raw_materials to a group as its colors.
export const linkGroupColorsSchema = z.object({
  raw_material_ids: z
    .array(z.string().min(1))
    .min(1, "At least one raw material is required"),
})
export type LinkGroupColors = z.infer<typeof linkGroupColorsSchema>

// --- Order a group in multiple colors (fan-out) ---

const groupOrderLineSchema = z.object({
  raw_material_id: z.string().min(1, "raw_material_id is required"),
  quantity: z.number().nonnegative("Quantity must be zero or positive"),
  price: z.number().nonnegative("Price must be zero or positive"),
})

export const createGroupOrderSchema = z
  .object({
    lines: z
      .array(groupOrderLineSchema)
      .min(1, "At least one color line is required"),
    status: z.enum(
      INVENTORY_ORDER_STATUS_INPUT as [
        InventoryOrderInputStatus,
        ...InventoryOrderInputStatus[]
      ]
    ),
    currency_code: z.string().min(3).max(3).optional(),
    expected_delivery_date: z.coerce.date(),
    order_date: z.coerce.date(),
    shipping_address: z.record(z.string(), z.unknown()),
    stock_location_id: z.string(),
    from_stock_location_id: z.string().optional(),
    to_stock_location_id: z.string().optional(),
    is_sample: z.boolean().optional().default(false),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((data, ctx) => {
    const toId = data.to_stock_location_id || data.stock_location_id
    if (!toId || toId.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A 'to' stock location is required (use stock_location_id or to_stock_location_id)",
        path: ["to_stock_location_id"],
      })
    }
    if (
      data.from_stock_location_id &&
      toId &&
      data.from_stock_location_id === toId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "from_stock_location_id cannot be the same as the 'to' stock location",
        path: ["from_stock_location_id"],
      })
    }
  })
export type CreateGroupOrder = z.infer<typeof createGroupOrderSchema>

export const readGroupQuerySchema = z.object({
  fields: z.string().optional(),
})
