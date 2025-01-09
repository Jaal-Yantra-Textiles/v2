import { z } from "zod";

const materialTypeSchema = z.object({
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

const rawMaterialDataSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  composition: z.string().min(1, "Composition is required"),
  specifications: z.record(z.any()).optional(),
  unit_of_measure: z.enum([
    "Meter",
    "Yard",
    "Kilogram",
    "Gram",
    "Piece",
    "Roll",
    "Other"
  ]).optional().default("Other"),
  minimum_order_quantity: z.number().positive().optional(),
  lead_time_days: z.number().positive().optional(),
  color: z.string().optional(),
  width: z.string().optional(),
  weight: z.string().optional(),
  grade: z.string().optional(),
  certification: z.record(z.any()).optional(),
  usage_guidelines: z.string().optional(),
  storage_requirements: z.string().optional(),
  status: z.enum([
    "Active",
    "Discontinued",
    "Under_Review",
    "Development"
  ]).optional().default("Active"),
  metadata: z.record(z.any()).optional(),
  material_type: materialTypeSchema.optional()
});

export const rawMaterialSchema = z.object({
  rawMaterialData: rawMaterialDataSchema
});

export type RawMaterial = z.infer<typeof rawMaterialSchema>;
export type UpdateRawMaterial = Partial<RawMaterial>;
