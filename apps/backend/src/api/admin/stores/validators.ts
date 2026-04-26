import { z } from "@medusajs/framework/zod";

// Schema for creating a new store
export const createStoreSchema = z.object({
  name: z.string().min(1, "Store name is required"),
  supported_currencies: z.array(z.object({
    currency_code: z.string().length(3, "Currency code must be 3 characters"),
    is_default: z.boolean().optional()
  })).min(1, "At least one currency is required"),
  default_sales_channel_id: z.string().optional(),
  default_region_id: z.string().optional(),
  default_location_id: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

// Schema for updating a store
export const updateStoreSchema = z.object({
  name: z.string().min(1, "Store name is required").optional(),
  supported_currencies: z.array(z.object({
    currency_code: z.string().length(3, "Currency code must be 3 characters"),
    is_default: z.boolean().optional()
  })).optional(),
  default_sales_channel_id: z.string().optional(),
  default_region_id: z.string().optional(),
  default_location_id: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

// Schema for listing stores with query parameters
export const listStoresQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  offset: z.coerce.number().min(0).optional().default(0),
  name: z.string().optional(),
  currency_code: z.string().optional()
});

// Schema for getting a single store
export const getStoreQuerySchema = z.object({
  fields: z.string().optional()
});

export type CreateStoreRequest = z.infer<typeof createStoreSchema>;
export type UpdateStoreRequest = z.infer<typeof updateStoreSchema>;
export type ListStoresQuery = z.infer<typeof listStoresQuerySchema>;
export type GetStoreQuery = z.infer<typeof getStoreQuerySchema>;
