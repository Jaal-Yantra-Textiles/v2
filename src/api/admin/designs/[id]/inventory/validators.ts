import { z } from "zod";

export const AdminPostDesignInventoryReq = z.object({
    inventoryIds: z.array(z.string()),
})

export type AdminPostDesignInventoryReq = z.infer<typeof AdminPostDesignInventoryReq>

export const AdminDeleteDesignInventoryReq = z.object({
    inventoryIds: z.array(z.string()),
})

export type AdminDeleteDesignInventoryReq = z.infer<typeof AdminDeleteDesignInventoryReq>