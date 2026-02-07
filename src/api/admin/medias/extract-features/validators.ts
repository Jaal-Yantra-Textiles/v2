import { z } from "zod";

/**
 * Request schema for POST /admin/medias/extract-features
 * Initiates textile product extraction from a media file
 */
export const ExtractFeaturesRequestSchema = z.object({
  /** Media file ID to extract features from */
  media_id: z.string().min(1, "media_id is required"),
  /** Optional hints to guide the extraction process */
  hints: z.array(z.string()).optional(),
  /** Whether to persist extraction results to media metadata */
  persist: z.boolean().optional().default(false),
});

export type ExtractFeaturesRequest = z.infer<typeof ExtractFeaturesRequestSchema>;

/**
 * Response schema for POST /admin/medias/extract-features
 */
export type ExtractFeaturesResponse = {
  message: string;
  transaction_id: string;
  status: "pending_confirmation";
};

/**
 * Response schema for GET /admin/medias/extract-features/:transaction_id
 */
export type ExtractFeaturesStatusResponse = {
  transaction_id: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: TextileExtractionResult;
  error?: string;
  created_at?: string;
  updated_at?: string;
};

/**
 * Textile extraction result structure
 */
export type TextileExtractionResult = {
  title: string;
  description: string;
  designer?: string | null;
  model_name?: string | null;
  cloth_type?: string | null;
  pattern?: string | null;
  fabric_weight?: string | null;
  care_instructions?: string[];
  season?: string[];
  occasion?: string[];
  colors?: string[];
  category?: string | null;
  suggested_price?: { amount: number; currency: string } | null;
  seo_keywords?: string[];
  target_audience?: string | null;
  confidence?: number;
};
