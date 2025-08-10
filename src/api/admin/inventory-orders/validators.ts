import { z } from "zod";
// Query schema for listing inventory orders
import { INVENTORY_ORDER_STATUS } from "../../../modules/inventory_orders/constants";


export const inventoryOrderLineInputSchema = z.object({
  inventory_item_id: z.string().min(1, "Inventory item ID is required"),
  quantity: z.number().int().nonnegative("Quantity must be a non-negative integer"), // Allow 0
  price: z.number().nonnegative("Price must be zero or positive"),
  metadata: z.record(z.unknown()).optional(),
});

export const createInventoryOrdersSchema = z.object({
  order_lines: z.array(inventoryOrderLineInputSchema).min(1, "At least one order line is required"),
  quantity: z.number().int().nonnegative("Order quantity must be a non-negative integer"),
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
      message: "Order quantity must be a positive integer for non-sample orders",
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

export const ReadSingleInventoryOrderQuerySchema = z.object({
  fields: z.string().optional(),
})

export const updateInventoryOrdersSchema = createInventoryOrdersSchema._def.schema.partial();

export type UpdateInventoryOrder = z.infer<typeof updateInventoryOrdersSchema>;

export type CreateInventoryOrder = z.infer<typeof createInventoryOrdersSchema>;


export const listInventoryOrdersQuerySchema = z.object({
  status: z.enum(INVENTORY_ORDER_STATUS).optional(),
  q: z.string().optional(),
  quantity: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().positive().optional()
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

export type ListInventoryOrdersQuery = z.infer<typeof listInventoryOrdersQuerySchema>;
