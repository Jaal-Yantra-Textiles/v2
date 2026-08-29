import { z } from "@medusajs/framework/zod";
// Query schema for listing inventory orders
import {
  INVENTORY_ORDER_STATUS,
  INVENTORY_ORDER_STATUS_INPUT,
  type InventoryOrderInputStatus,
} from "../../../modules/inventory_orders/constants";

// Input schema for inventory order lines
export const inventoryOrderLineInputSchema = z.object({
  inventory_item_id: z.string().min(1, "Inventory item ID is required"),
  // Allow decimal quantities >= 0 (0 allowed for empty seeded rows)
  quantity: z.number().nonnegative("Quantity must be zero or positive"),
  price: z.number().nonnegative("Price must be zero or positive"),
  // Optional batch tag for the "keep batches as separate lines" quick-add mode.
  batch_number: z.number().int().positive().nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Base ZodObject — kept separately so we can call .partial() on it for the
// update schema. Going through createInventoryOrdersSchema._def.schema breaks
// under Zod v4 (the internal _def shape changed; superRefine no longer exposes
// the inner schema at that path).
const inventoryOrdersBaseSchema = z.object({
  order_lines: z.array(inventoryOrderLineInputSchema).min(1, "At least one order line is required"),
  // Allow decimal order quantity (sum of line quantities)
  quantity: z.number().nonnegative("Order quantity must be zero or positive"),
  total_price: z.number().nonnegative("Total price must be zero or positive"),
  // #778 H9 — ISO currency code; defaults to inr at the DB layer when omitted.
  currency_code: z.string().min(3).max(3).optional(),
  // System-only statuses (e.g. "Partial") are intentionally excluded — see
  // INVENTORY_ORDER_STATUS_INPUT in the module constants (#778 H8).
  status: z.enum(
    INVENTORY_ORDER_STATUS_INPUT as [
      InventoryOrderInputStatus,
      ...InventoryOrderInputStatus[]
    ]
  ),
  expected_delivery_date: z.coerce.date(),
  order_date: z.coerce.date(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  shipping_address: z.record(z.string(), z.unknown()),
  stock_location_id: z.string(),
  from_stock_location_id: z.string().optional(),
  to_stock_location_id: z.string().optional(),
  is_sample: z.boolean().optional().default(false),
});

// Input schema for creating inventory orders
export const createInventoryOrdersSchema = inventoryOrdersBaseSchema.superRefine((data, ctx) => {
  if (!data.is_sample && data.quantity <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 1,
      // Zod v4 renamed the legacy `type` field to `origin` for size-bound issues.
      origin: "number",
      inclusive: true,
      message: "Order quantity must be a positive number for non-sample orders",
      path: ["quantity"],
    });
  }

  // Require a to location via either stock_location_id or to_stock_location_id
  const toId = data.to_stock_location_id || data.stock_location_id
  if (!toId || toId.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A 'to' stock location is required (use stock_location_id or to_stock_location_id)",
      path: ["to_stock_location_id"],
    })
  }

  // from and to must not be equal when both provided
  if (data.from_stock_location_id && toId && data.from_stock_location_id === toId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "from_stock_location_id cannot be the same as the 'to' stock location",
      path: ["from_stock_location_id"],
    })
  }
});

// Query schema for reading a single inventory order
export const ReadSingleInventoryOrderQuerySchema = z.object({
  fields: z.string().optional(),
})

// Input schema for updating inventory orders.
// `is_sample` carries `.optional().default(false)` on the base schema. A
// `.default()` survives `.partial()` in Zod v4, so an omitted `is_sample` on a
// partial update would silently inject `false` and flip a sample order to a
// non-sample one (the route spreads `...validatedBody` into the update input).
// Re-declare as plain optional (no default) so omission stays omitted.
export const updateInventoryOrdersSchema = inventoryOrdersBaseSchema
  .partial()
  .extend({ is_sample: z.boolean().optional() });

// Type definitions for inventory orders
export type UpdateInventoryOrder = z.infer<typeof updateInventoryOrdersSchema>;
export type CreateInventoryOrder = z.infer<typeof createInventoryOrdersSchema>;

// Preprocessor that handles both a plain ISO date string and a
// filter-object with $gte / $lte keys (sent as bracket notation in URLs,
// e.g. order_date[$gte]=2026-03-01T00:00:00.000Z).
function preprocessDateFilter(val: unknown) {
  if (val === undefined || val === null || val === "") return undefined
  if (typeof val === "string") return new Date(val)
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>
    const result: Record<string, Date> = {}
    if (obj.$gte) result.$gte = new Date(obj.$gte as string)
    if (obj.$lte) result.$lte = new Date(obj.$lte as string)
    if (obj.$gt)  result.$gt  = new Date(obj.$gt  as string)
    if (obj.$lt)  result.$lt  = new Date(obj.$lt  as string)
    return Object.keys(result).length > 0 ? result : undefined
  }
  return undefined
}

const dateFilterSchema = z.union([
  z.date(),
  z.object({
    $gte: z.date().optional(),
    $lte: z.date().optional(),
    $gt:  z.date().optional(),
    $lt:  z.date().optional(),
  }),
]).optional()

// Query schema for listing inventory orders
export const listInventoryOrdersQuerySchema = z.object({
  status: z.enum(INVENTORY_ORDER_STATUS).optional(),
  q: z.string().optional(),
  // Allow decimal filter for quantity in queries as well
  quantity: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().positive().optional()
  ),
  total_price: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().nonnegative().optional()
  ),
  expected_delivery_date: z.preprocess(preprocessDateFilter, dateFilterSchema),
  order_date: z.preprocess(preprocessDateFilter, dateFilterSchema),
  offset: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(0).default(0)
  ),
  limit: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(1).max(100).default(20)
  ),
  order: z.string().optional(),
  // Add more fields as needed
});

// Type definition for listing inventory orders query
export type ListInventoryOrdersQuery = z.infer<typeof listInventoryOrdersQuerySchema>;

// Schema for updating order lines
export const updateOrderLineSchema = z
  .object({
    id: z.string().optional(), // Existing lines have IDs
    inventory_item_id: z.string().optional(),
    quantity: z.number().optional(),
    price: z.number().optional(),
    // Optional batch tag (see inventoryOrderLineInputSchema).
    batch_number: z.number().int().positive().nullish(),
    // Explicit removal marker for an existing line: the update workflow
    // soft-deletes the line (by `id`) and dismisses its inventory-item link.
    // Without this key the middleware would strip it and a dropped line would
    // silently survive. A removal marker only needs `id` — the other fields
    // are ignored server-side (compensation reads the prior values).
    remove: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.remove) {
      if (!val.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["id"],
          message: "A removal marker requires the existing line id",
        });
      }
      return; // removals skip the create/update field requirements
    }
    if (!val.inventory_item_id || val.inventory_item_id.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inventory_item_id"],
        message: "Inventory item ID is required",
      });
    }
    if (val.quantity == null || val.quantity < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "Quantity must be at least 1",
      });
    }
    if (val.price == null || val.price < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "Price must be non-negative",
      });
    }
  });

export const updateInventoryOrderLinesSchema = z.object({
  data: z.object({
    quantity: z.number().optional(),
    total_price: z.number().optional(),
  }).optional(),
  order_lines: z.array(updateOrderLineSchema).min(1, "At least one order line is required"),
});

export type UpdateInventoryOrderLines = z.infer<typeof updateInventoryOrderLinesSchema>;
