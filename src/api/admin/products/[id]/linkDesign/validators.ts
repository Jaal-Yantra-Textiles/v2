import { z } from "@medusajs/framework/zod"

export const LinkDesignValidator = z.object({
    designId: z.string(),
})

export const UnlinkDesignValidator = z.object({
    designId: z.string(),
})

export type LinkDesignValidator = z.infer<typeof LinkDesignValidator>
export type UnlinkDesignValidator = z.infer<typeof UnlinkDesignValidator>