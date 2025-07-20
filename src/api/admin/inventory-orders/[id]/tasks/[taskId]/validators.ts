import { z } from "zod";

export const UpdateInventoryOrderTask = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  due_date: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type UpdateInventoryOrderTask = z.infer<typeof UpdateInventoryOrderTask>;
