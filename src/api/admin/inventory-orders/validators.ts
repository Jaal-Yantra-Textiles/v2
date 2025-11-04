import { z } from "zod";
// Query schema for listing inventory orders
import { INVENTORY_ORDER_STATUS } from "../../../modules/inventory_orders/constants";

// Input schema for inventory order lines
export const inventoryOrderLineInputSchema = z.object({
  inventory_item_id: z.string().min(1, "Inventory item ID is required"),
  // Allow decimal quantities >= 0 (0 allowed for empty seeded rows)
  quantity: z.number().nonnegative("Quantity must be zero or positive"),
  price: z.number().nonnegative("Price must be zero or positive"),
  metadata: z.record(z.unknown()).optional(),
});

// Input schema for creating inventory orders
export const createInventoryOrdersSchema = z.object({
  order_lines: z.array(inventoryOrderLineInputSchema).min(1, "At least one order line is required"),
  // Allow decimal order quantity (sum of line quantities)
  quantity: z.number().nonnegative("Order quantity must be zero or positive"),
  total_price: z.number().nonnegative("Total price must be zero or positive"),
  status: z.enum(["Pending", "Processing", "Shipped", "Delivered", "Cancelled"]),
  expected_delivery_date: z.coerce.date(),
  order_date: z.coerce.date(),
  metadata: z.record(z.unknown()).optional(),
  shipping_address: z.record(z.unknown()),
  stock_location_id: z.string(),
  from_stock_location_id: z.string().optional(),
  to_stock_location_id: z.string().optional(),
  is_sample: z.boolean().optional().default(false),
}).superRefine((data, ctx) => {
  if (!data.is_sample && data.quantity <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 1,
      type: "number",
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

// Input schema for updating inventory orders
export const updateInventoryOrdersSchema = createInventoryOrdersSchema._def.schema.partial();

// Type definitions for inventory orders
export type UpdateInventoryOrder = z.infer<typeof updateInventoryOrdersSchema>;
export type CreateInventoryOrder = z.infer<typeof createInventoryOrdersSchema>;

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
  expected_delivery_date: z.preprocess(
    (val) => (val ? new Date(val as string) : undefined),
    z.date().optional()
  ),
  order_date: z.preprocess(
    (val) => (val ? new Date(val as string) : undefined),
    z.date().optional()
  ),
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
export const updateOrderLineSchema = z.object({
  id: z.string().optional(), // Existing lines have IDs
  inventory_item_id: z.string().min(1, "Inventory item ID is required"),
  quantity: z.number().min(1, "Quantity must be at least 1"),
  price: z.number().min(0, "Price must be non-negative"),
});

export const updateInventoryOrderLinesSchema = z.object({
  data: z.object({
    quantity: z.number().optional(),
    total_price: z.number().optional(),
  }).optional(),
  order_lines: z.array(updateOrderLineSchema).min(1, "At least one order line is required"),
});

export type UpdateInventoryOrderLines = z.infer<typeof updateInventoryOrderLinesSchema>;
