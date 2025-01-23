import { z } from "zod";

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
    "Custom"
  ]).optional(),
  status: z.enum([
    "Draft",
    "Published",
    "Archived"
  ]).optional(),
  meta_title: z.string().optional(),
  meta_description: z.string().optional(),
  meta_keywords: z.string().optional(),
  published_at: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
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