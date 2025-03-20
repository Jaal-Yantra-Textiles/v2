import { z } from "zod";

export const personSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  date_of_birth: z.string()
  .optional()
  .refine((val) => val ? !isNaN(new Date(val).getTime()) : true, {
    message: "Invalid date format"
  })
  .transform(val => val ? new Date(val) : undefined), // Optional field
  metadata: z.record(z.any()).optional(), // Optional field for additional data
  addresses: z.array(z.any()).optional(),
  state: z.enum(["Onboarding", "Onboarding Finished", "Stalled", "Conflicted"]).optional(),
  avatar: z.string().optional(),
});

export const ReadPersonQuerySchema = z.object({
  fields: z.string().optional(),
})
export const UpdatePersonSchema = personSchema.partial();

export type Person = z.infer<typeof personSchema>;
export type UpdatePerson = z.infer<typeof UpdatePersonSchema>;
