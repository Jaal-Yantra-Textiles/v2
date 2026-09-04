import { z } from "zod";

// Define a Zod schema for inventory order creation (scaffolded, update as per API contract)
export const inventoryOrderFormSchema = z
  .object({
    order_date: z.date({ error: "Order date is required" }),
    expected_delivery_date: z.date({ error: "Expected delivery date is required" }),
    // To location (required)
    stock_location_id: z.string().nonempty("To stock location is required"),
    // From location (optional)
    from_stock_location_id: z.string().optional(),
    is_sample: z.boolean().optional(),
    // #1671 — the grid is SEEDED with five blank rows so a buyer can start
    // typing. Validating every element meant those blanks failed
    // `inventory_item_id: min(1)` and `quantity: min(1)`, so handleSubmit's
    // callback never ran: Create did nothing, silently and forever, unless you
    // deleted four rows by hand. A row is therefore either blank (ignored) or
    // complete — checked in the superRefine below, where a blank can be told
    // apart from an unfinished one.
    order_lines: z.array(
      z.object({
        inventory_item_id: z.string(),
        quantity: z.number(),
        price: z.number(),
        // Per-unit extra charge on top of `price` (colour/dye job, finishing, …).
        extra_cost: z.number().optional(),
        batch_number: z.number().int().positive().nullish(), // batch tag (separate-batch adds)
      })
    ),
    // Order-level tax entered at create time (recorded as an order charge).
    tax_amount: z.number().nonnegative("Tax must be zero or positive").optional(),
  })
  .superRefine((data, ctx) => {
    const lines = data.order_lines ?? [];
    const filledIdx = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !!line?.inventory_item_id);

    if (!filledIdx.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick at least one item",
        path: ["order_lines"],
      });
    }

    for (const { line, index } of filledIdx) {
      if (!(Number(line.quantity) >= 1)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Quantity must be at least 1",
          path: ["order_lines", index, "quantity"],
        });
      }
      if (!(Number(line.price) >= 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Price must be non-negative",
          path: ["order_lines", index, "price"],
        });
      }
    }

    // Validate that from and to are not the same when both are provided
    if (data.from_stock_location_id && data.stock_location_id === data.from_stock_location_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "From and To stock locations must be different",
        path: ["from_stock_location_id"],
      });
    }
  });

export type InventoryOrderFormData = z.infer<typeof inventoryOrderFormSchema>;
