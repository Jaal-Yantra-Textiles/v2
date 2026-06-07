import { z } from "@medusajs/framework/zod";

export const ReadRawMaterialCategoriesSchema = z.object({
  config: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      }
      return val;
    },
    z.record(z.string(), z.unknown()).optional()
  ),
  filters: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      }
      return val;
    },
    z.record(z.string(), z.unknown()).optional()
  ),
  // Free-text search across name + description (case-insensitive, partial).
  q: z.string().optional(),
  // Convenience partial-match on name (case-insensitive). Both `q` and
  // `name` map to an ilike filter in the workflow.
  name: z.string().optional(),
  page: z.preprocess(
    (val) => {
      if (val && typeof val === "string") {
        return parseInt(val);
      }
      return val;
    },
    z.number().min(1).optional().default(1)
  ),
  // Offset-based pagination (admin combobox / SDK send `offset`). When
  // provided it takes precedence over `page`.
  offset: z.preprocess(
    (val) => {
      if (val && typeof val === "string") {
        return parseInt(val);
      }
      return val;
    },
    z.number().min(0).optional()
  ),
  limit: z.preprocess(
    (val) => {
      if (val && typeof val === "string") {
        return parseInt(val);
      }
      return val;
    },
    z.number().min(1).max(100).optional().default(10)
  )
});

export type ReadRawMaterialCategoriesType = z.infer<typeof ReadRawMaterialCategoriesSchema>;


export const CreateMaterialTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.enum([
    "Fiber",
    "Yarn",
    "Fabric",
    "Trim",
    "Dye",
    "Chemical",
    "Accessory",
    "Other"
  ]).optional().default("Other"),
  properties: z.record(z.string(), z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

export type CreateMaterialTypeType = z.infer<typeof CreateMaterialTypeSchema>;
