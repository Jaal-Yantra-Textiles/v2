import { z } from "zod";

export const AdminPostDesignInventoryReq = z.object({
    inventoryIds: z.array(z.string()),
})

export type AdminPostDesignInventoryReq = z.infer<typeof AdminPostDesignInventoryReq>