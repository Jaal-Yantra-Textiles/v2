import { z } from "zod";

const expectedItemSchema = z.object({
  name: z.string().optional(),
  min_quantity: z.number().optional(),
  unit: z.string().optional(),
});

export const AdminImageExtractionReq = z.object({
  image_url: z
    .string()
    .refine(
      (s) => {
        if (!s) return false
        if (s.startsWith("data:")) return true
        try {
          new URL(s)
          return true
        } catch {
          return false
        }
      },
      { message: "image_url must be a valid URL or data URI" }
    ),
  entity_type: z.enum(["raw_material", "inventory_item"]).default("raw_material"),
  notes: z.string().optional(),
  // Memory context
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  // Enhancement: domain hints to prime extraction
  hints: z
    .object({
      allowed_units: z.array(z.string()).optional(),
      default_unit: z.string().optional(),
      known_items: z.array(z.string()).optional(),
      additional_context: z.string().optional(),
    })
    .optional(),
  // Enhancement: verification rules after extraction
  verify: z
    .object({
      min_items: z.number().min(0).optional(),
      required_fields: z.array(z.enum(["name", "quantity", "unit"]).describe("Required fields each item must contain")).optional(),
      expected_items: z.array(expectedItemSchema).optional(),
    })
    .optional(),
  // Defaults/hints for extraction + creation pipeline
  defaults: z
    .object({
      notes: z.string().optional(),
      raw_materials: z
        .object({
          width_inch: z.number().optional(),
          material_type: z.string().optional(),
        })
        .optional(),
      inventory: z
        .object({
          stock_location_id: z.string().optional(),
          default_stocked_quantity: z.number().optional(),
          default_incoming_quantity: z.number().optional(),
          incoming_from_extraction: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  // Optional persistence flag for later chunk
  persist: z.boolean().optional(),
});

export type AdminImageExtractionReqType = z.infer<typeof AdminImageExtractionReq>;
