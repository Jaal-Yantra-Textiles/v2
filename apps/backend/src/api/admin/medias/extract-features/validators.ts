import { z } from "@medusajs/framework/zod";

/**
 * Request schema for POST /admin/medias/extract-features
 * Initiates textile product extraction from a media file
 */
export const ExtractFeaturesRequestSchema = z.object({
  /** Media file ID to extract features from */
  media_id: z.string().min(1, "media_id is required"),
  /** Optional hints to guide the extraction process */
  hints: z.array(z.string()).optional(),
  /** Gender context for correct interpretation of sizing, fit, and target audience */
  gender: z.enum(["female", "male", "unisex"]).optional().default("unisex"),
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
 * Raw face details extracted from model — internal use only
 */
export type FaceRaw = {
  estimated_age_range?: string | null;
  skin_tone?: string | null;
  hair_color?: string | null;
  hair_style?: string | null;
  eye_color?: string | null;
  facial_features?: string[];
};

/**
 * Raw body details extracted from model — internal use only
 */
export type BodyRaw = {
  body_type?: string | null;
  estimated_height?: string | null;
  pose?: string | null;
  skin_tone?: string | null;
};

/**
 * Shot/styling characteristics — internal use only
 */
export type ModelCharacteristics = {
  gender_presentation?: string | null;
  styling?: string | null;
  overall_vibe?: string | null;
  shot_type?: string | null;
};

/**
 * Textile extraction result structure
 */
export type TextileExtractionResult = {
  // Garment / product catalog fields
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

  // Raw internal fields — NOT for customer display
  face_raw?: FaceRaw | null;
  body_raw?: BodyRaw | null;
  model_characteristics?: ModelCharacteristics | null;
};
