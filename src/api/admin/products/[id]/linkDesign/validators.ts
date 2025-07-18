import  zod, { z }  from "zod"

export const LinkDesignValidator = zod.object({
    designId: z.string(),
})

export const UnlinkDesignValidator = zod.object({
    designId: z.string(),
})

export type LinkDesignValidator = z.infer<typeof LinkDesignValidator>
export type UnlinkDesignValidator = z.infer<typeof UnlinkDesignValidator>