import { z } from "zod";

const blockBaseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum([
    "Hero",
    "Header",
    "Footer",
    "MainContent",
    "ContactForm",
    "Feature",
    "Gallery",
    "Testimonial",
    "Product",
    "Section",
    "Custom"
  ]),
  content: z.record(z.unknown()),
  settings: z.record(z.unknown()).optional(),
  order: z.number().optional(),
  status: z.enum([
    "Active",
    "Inactive",
    "Draft"
  ]).optional(),
  metadata: z.record(z.unknown()).optional(),
});


// Schema specifically for reading blocks with query parameters
export const ReadBlocksQuerySchema = z.object({
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

export const blockSchema = blockBaseSchema;

export const createBlocksSchema = z.object({
  blocks: z.array(blockBaseSchema),
});

export const deleteBlockSchema = z.object({
  blockId: z.string().uuid("Invalid ID format"),
});

export const updateBlockSchema = blockBaseSchema.partial();



export type BlockSchema = z.infer<typeof blockSchema>;
export type CreateBlocksSchema = z.infer<typeof createBlocksSchema>;
export type DeleteBlockSchema = z.infer<typeof deleteBlockSchema>;
export type UpdateBlockSchema = z.infer<typeof updateBlockSchema>;
export type ReadBlocksQuerySchema = z.infer<typeof ReadBlocksQuerySchema>;
