import { z } from "zod";

export const personTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

export const deletePersonTypeSchema = z.object({
  id: z.string().uuid("Invalid ID format"), // Assuming the ID is a UUID
});

export const updatePersonTypeSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});

export type PersonTypeSchema = z.infer<typeof personTypeSchema>;
export type DeletePersonTypeSchema = z.infer<typeof deletePersonTypeSchema>;
export type UpdatePersonTypeSchema = z.infer<typeof updatePersonTypeSchema>;
