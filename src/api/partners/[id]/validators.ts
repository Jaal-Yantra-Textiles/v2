import { z } from "@medusajs/framework/zod"
import { personSchema } from "../../admin/persons/validators"

export const partnerPeopleSchema = z.object({
    people: personSchema.array(),
})

export type PartnerPeopleSchema = z.infer<typeof partnerPeopleSchema>