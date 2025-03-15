import { z } from "zod";

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
    z.record(z.unknown()).optional()
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
    z.record(z.unknown()).optional()
  ),
  page: z.preprocess(
    (val) => {
      if (val && typeof val === "string") {
        return parseInt(val);
      }
      return val;
    },
    z.number().min(1).optional().default(1)
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
  properties: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional()
});

export type CreateMaterialTypeType = z.infer<typeof CreateMaterialTypeSchema>;
