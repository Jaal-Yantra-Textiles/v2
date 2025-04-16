import { z } from "zod";

export const inventoryOrderLineInputSchema = z.object({
  inventory_item_id: z.string().min(1, "Inventory item ID is required"),
  quantity: z.number().int().positive("Quantity must be a positive integer"),
  price: z.number().nonnegative("Price must be zero or positive"),
  metadata: z.record(z.unknown()).optional(),
});

export const createInventoryOrdersSchema = z.object({
  order_lines: z.array(inventoryOrderLineInputSchema).min(1, "At least one order line is required"),
  quantity: z.number().int().positive("Order quantity must be a positive integer"),
  total_price: z.number().nonnegative("Total price must be zero or positive"),
  status: z.enum(["Pending", "Processing", "Shipped", "Delivered", "Cancelled"]),
  expected_delivery_date: z.coerce.date(),
  order_date: z.coerce.date(),
  metadata: z.record(z.unknown()).optional(),
  shipping_address: z.record(z.unknown()),
});

export const updateInventoryOrdersSchema = createInventoryOrdersSchema.partial();

export type UpdateInventoryOrder = z.infer<typeof updateInventoryOrdersSchema>;

export type CreateInventoryOrder = z.infer<typeof createInventoryOrdersSchema>;
