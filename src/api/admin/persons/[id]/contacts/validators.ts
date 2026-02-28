import { z } from "@medusajs/framework/zod";

export const contactSchema = z.object({
  type: z.enum(["mobile", "home", "work"]),
  phone_number: z.string().min(1, "Phone number is required"),
});
