import { z } from "@medusajs/framework/zod";

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
  properties: z.record(z.string(), z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

// Enum value lists kept as shared consts so the create (default-bearing) and
// update (default-free) schemas stay in sync without duplicating the literals.
const unitOfMeasureValues = [
  "Meter",
  "Yard",
  "Kilogram",
  "Gram",
  "Piece",
  "Roll",
  "Other",
] as const;

const rawMaterialStatusValues = [
  "Active",
  "Discontinued",
  "Under_Review",
  "Development",
] as const;

const rawMaterialDataSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required").optional(),
  composition: z.string().min(1, "Composition is required"),
  specifications: z.record(z.string(), z.any()).optional(),
  unit_of_measure: z.enum(unitOfMeasureValues).optional().default("Other"),
  unit_cost: z.number().positive().optional(),
  cost_currency: z.string().optional(),
  minimum_order_quantity: z.number().positive().optional(),
  lead_time_days: z.number().positive().optional(),
  color: z.string().optional(),
  width: z.string().optional(),
  weight: z.string().optional(),
  grade: z.string().optional(),
  certification: z.record(z.string(), z.any()).optional(),
  usage_guidelines: z.string().optional(),
  storage_requirements: z.string().optional(),
  status: z.enum(rawMaterialStatusValues).optional().default("Active"),
  metadata: z.record(z.string(), z.any()).optional(),
  material_type: z.string().optional(),
  material_type_id: z.string().optional(),
  media: z.record(z.string(), z.any()).optional()
});

export const rawMaterialSchema = z.object({
  rawMaterialData: rawMaterialDataSchema
});

export type RawMaterial = z.infer<typeof rawMaterialSchema>;
export type UpdateRawMaterial = Partial<RawMaterial>;

// `unit_of_measure` and `status` carry `.optional().default(...)` on the base
// schema. A `.default()` survives `.partial()` in Zod v4, so omitting them on a
// partial update would silently inject "Other"/"Active" and clobber a material's
// real unit/status (the route persists `rawMaterialData` straight to the update
// workflow). Re-declare as plain optional (no default) so omission stays omitted.
export const UpdateRawMaterialSchema = z.object({
  rawMaterialData: rawMaterialDataSchema.partial().extend({
    unit_of_measure: z.enum(unitOfMeasureValues).optional(),
    status: z.enum(rawMaterialStatusValues).optional(),
  }),
});

