import { z } from "@medusajs/framework/zod";

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
  content: z.record(z.string(), z.unknown()),
  settings: z.record(z.string(), z.unknown()).optional(),
  order: z.number().optional(),
  status: z.enum([
    "Active",
    "Inactive",
    "Draft"
  ]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
      // `config[take]=10` arrives as the *string* "10". The workflow echoes
      // take/skip straight back as `limit`/`offset`, so without this the
      // endpoint answers `"limit": "10"` — a typed field returning a string.
      // Sibling `page`/`limit` params below have always been coerced; the
      // numerics nested under `config` were missed.
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const out: Record<string, unknown> = { ...(val as Record<string, unknown>) };
        for (const key of ["take", "skip"]) {
          if (typeof out[key] === "string" && out[key] !== "") {
            const n = Number(out[key]);
            if (Number.isFinite(n)) {
              out[key] = n;
            }
          }
        }
        return out;
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
  blocks: z.array(blockBaseSchema).min(1, "At least one block is required"),
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
