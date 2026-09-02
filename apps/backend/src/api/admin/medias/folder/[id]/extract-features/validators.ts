import { z } from "@medusajs/framework/zod";

/**
 * Request schema for POST /admin/medias/folder/:id/extract-features
 * Initiates folder-wide, rate-limited textile feature extraction
 */
export const ExtractFolderFeaturesRequestSchema = z.object({
  /** Optional hints to guide the extraction process for every photo */
  hints: z.array(z.string()).optional(),
  /** Gender context for correct interpretation of sizing, fit, and target audience */
  gender: z.enum(["female", "male", "unisex"]).optional().default("unisex"),
  /** Whether to persist extraction results to each media file's metadata */
  persist: z.boolean().optional().default(false),
  /**
   * Milliseconds to wait between photos. Defaults to 60000 (1 photo per minute).
   * Clamped between 5 seconds and 15 minutes.
   */
  interval_ms: z.number().int().positive().optional(),
  /**
   * Restrict the run to these media files (#1742).
   *
   * 🔴 The workflow has accepted `media_ids` since it was written, but this
   * schema never declared it and the route never destructured it — so the only
   * thing the API could ask for was "all 62 images", and a folder left half
   * done by a deploy had no way back except paying for the whole folder again.
   * A field the caller cannot send is a capability that does not exist.
   */
  media_ids: z.array(z.string()).optional(),
  /**
   * `pending` skips images that already have a `textile_analysis` row, which is
   * what turns a re-run into a resume. Default `all` keeps the original
   * behaviour for anyone deliberately re-extracting a folder.
   */
  scope: z.enum(["all", "pending"]).optional().default("all"),
});

export type ExtractFolderFeaturesRequest = z.infer<typeof ExtractFolderFeaturesRequestSchema>;

/**
 * Response schema for POST /admin/medias/folder/:id/extract-features
 */
export type ExtractFolderFeaturesResponse = {
  message: string;
  transaction_id: string;
  status: "pending_confirmation";
  folder_id: string;
  total_images?: number;
};

/**
 * Response schema for GET /admin/medias/folder/:id/extract-features/status
 */
export type ExtractFolderFeaturesStatusResponse = {
  folder_id: string;
  has_run: boolean;
  progress: {
    status: "running" | "completed" | "failed";
    total: number;
    completed: number;
    failed: number;
    interval_ms?: number;
    started_at?: string;
    updated_at?: string;
    finished_at?: string | null;
    last_media_id?: string | null;
    errors?: Array<{ media_id: string; error: string }>;
  } | null;
};
