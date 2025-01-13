import { z } from "zod"

export const AdminPostDesignTaskReq = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  eventable: z.boolean().optional(),
  notifiable: z.boolean().optional(),
  metadata: z.record(z.any()).optional()
})

export const AdminPutDesignTaskReq = AdminPostDesignTaskReq.partial()

export type UpdateDesignTask = z.infer<typeof AdminPutDesignTaskReq>;
