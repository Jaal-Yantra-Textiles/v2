import { z } from "zod"

enum Status {
  pending = "pending",
  in_progress = "in_progress",
  completed = "completed",
  cancelled = "cancelled",
  accepted = "accepted",
}
enum PriorityLevel {
  low = "low",
  medium = "medium",
  high = "high",
}
export const AdminPostDesignTaskReq = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.nativeEnum(Status).optional(),
  priority: z.nativeEnum(PriorityLevel).optional(),
  start_date: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
  end_date: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
  eventable: z.boolean().optional(),
  notifiable: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
})

export const AdminPutDesignTaskReq = AdminPostDesignTaskReq.partial()

export type UpdateDesignTask = z.infer<typeof AdminPutDesignTaskReq>;
