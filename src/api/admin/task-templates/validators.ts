import { z } from "@medusajs/framework/zod";

const categorySchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

export const taskTemplateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string(),
  category: z.string().optional(),
  estimated_duration: z.number().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  required_fields: z.record(z.any()).optional(),
  eventable: z.boolean().optional(),
  notifiable: z.boolean().optional(),
  message_template: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  category_id: z.string().optional()
});

export const updateTaskTemplateSchema = taskTemplateSchema.partial();

export type TaskTemplate = z.infer<typeof taskTemplateSchema>;
export type UpdateTaskTemplate = z.infer<typeof updateTaskTemplateSchema>;
