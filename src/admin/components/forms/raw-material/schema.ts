import { z } from "@medusajs/framework/zod"

// Define the material type schema for existing types (with ID)
export const existingMaterialTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().nullable(),
  category: z.enum([
    "Fiber",
    "Yarn",
    "Fabric",
    "Trim",
    "Dye",
    "Chemical",
    "Accessory",
    "Other"
  ]),
  isExisting: z.literal(true)
});

// Define the material type schema for new types
export const newMaterialTypeSchema = z.object({
  name: z.string().min(1, "Material type name is required"),
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
  ]).default("Other").optional(),
  properties: z.record(z.any()).optional(),
});

// Union type for material_type - can be string, existing type object, or new type object
const materialTypeUnionSchema = z.union([
  z.string(),
  existingMaterialTypeSchema,
  newMaterialTypeSchema
]);

// Schema for material type properties with some predefined keys but extensible
const materialTypePropertiesSchema = z
  .object({
    weave_type: z.string().optional(),
    gi_status: z.string().optional(),
    technique: z.string().optional(),
    extra: z
      .array(
        z.object({
          key: z.string().min(1, "Key is required"),
          value: z.string().optional(),
        })
      )
      .optional(),
  })
  .catchall(z.any())
  .optional();

export const rawMaterialFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  composition: z.string().min(1, "Composition is required"),
  unit_of_measure: z.enum([
    "Meter",
    "Yard",
    "Kilogram",
    "Gram",
    "Piece",
    "Roll",
    "Other"
  ]).default("Other").optional(),
  minimum_order_quantity: z.number().positive().optional(),
  lead_time_days: z.number().positive().optional(),
  color: z.string().optional(),
  width: z.string().optional(),
  weight: z.string().optional(),
  grade: z.string().optional(),
  certification: z.record(z.any()).optional(),
  usage_guidelines: z.string().optional(),
  storage_requirements: z.string().optional(),
  material_type_properties: materialTypePropertiesSchema,
  additional_properties_json: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        try {
          JSON.parse(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid JSON format" }
    ),
  status: z.enum([
    "Active",
    "Discontinued",
    "Under_Review",
    "Development"
  ]).default("Active").optional(),
  material_type: materialTypeUnionSchema.optional()
})

export type RawMaterialFormType = z.infer<typeof rawMaterialFormSchema>
