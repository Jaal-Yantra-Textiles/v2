import {z} from "@medusajs/framework/zod"

export const AdminPostDesignTaskAssignReq = z.object({
    taskId: z.string(),
    partnerId: z.string()
})

export type AdminPostDesignTaskAssignReq = z.infer<typeof AdminPostDesignTaskAssignReq>