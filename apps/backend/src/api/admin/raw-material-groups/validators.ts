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

export const createRawMaterialGroupSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  composition: z.string().optional(),
  specifications: z.record(z.string(), z.unknown()).optional(),
  unit_of_measure: z.enum(UNIT_OF_MEASURE).optional(),
  status: z.enum(GROUP_STATUS).optional(),
  material_type_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  media: z.record(z.string(), z.unknown()).optional(),
})
export type CreateRawMaterialGroup = z.infer<typeof createRawMaterialGroupSchema>

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
  unit_of_measure: z.enum(UNIT_OF_MEASURE).optional(),
  material_type_id: z.string().optional(),
  unit_cost: z.number().optional(),
  cost_currency: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  media: z.record(z.string(), z.unknown()).optional(),
})
export type AddGroupColor = z.infer<typeof addGroupColorSchema>

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
