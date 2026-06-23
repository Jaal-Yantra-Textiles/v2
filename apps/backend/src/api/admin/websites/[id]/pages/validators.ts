import { z } from "@medusajs/framework/zod";

const pageBaseSchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(1, "Slug is required"),
  content: z.string().min(1, "Content is required"),
  page_type: z.enum([
    "Home",
    "About",
    "Contact",
    "Blog",
    "Product",
    "Service",
    "Portfolio",
    "Landing",
    "Custom",
    "Newsletter"
  ]).optional(),
  status: z.enum([
    "Draft",
    "Published",
    "Archived"
  ]).optional(),
  meta_title: z.string().optional(),
  meta_description: z.string().optional(),
  meta_keywords: z.string().optional(),
  // Three valid client intents:
  //   undefined → "don't touch" — must stay undefined so the update
  //               workflow can skip the field (previously coerced to
  //               null, which nuked published_at on every update)
  //   null      → "explicitly clear" (e.g. unpublishing back to draft
  //               with manual clear)
  //   Date/ISO  → "set to this value"
  // Auto-stamping on Draft→Published happens in the workflow, not
  // here — the validator stays a pure pass-through.
  published_at: z.union([z.date(), z.string().datetime(), z.null()])
    .optional()
    .transform((val) => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      return val instanceof Date ? val : new Date(val);
    }),
  metadata: z.record(z.string(), z.unknown()).optional(),
  genMetaDataLLM: z.boolean().optional().default(false),
  public_metadata: z.record(z.string(), z.unknown()).optional(),
});

export const pageSchema = pageBaseSchema;

export const createPagesSchema = z.object({
  pages: z.array(pageBaseSchema),
});

export const deletePageSchema = z.object({
  pageId: z.string().uuid("Invalid ID format"),
});

// Modified to directly use the union without the payload wrapper
export const postPagesSchema = z.union([
  pageSchema,
  createPagesSchema
]);

export const updatePageSchema = pageBaseSchema.partial();

export type PageSchema = z.infer<typeof pageSchema>;
export type CreatePagesSchema = z.infer<typeof createPagesSchema>;
export type DeletePageSchema = z.infer<typeof deletePageSchema>;
export type UpdatePageSchema = z.infer<typeof updatePageSchema>;