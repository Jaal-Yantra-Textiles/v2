import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { toast } from "@medusajs/ui";
import { mediaFolderDetailQueryKeys } from "./media-folders/use-media-folder-detail";

/**
 * Request/Response types for textile extraction API
 */
export type ExtractFeaturesRequest = {
  media_id: string;
  hints?: string[];
  gender?: "female" | "male" | "unisex";
  persist?: boolean;
};

export type ExtractFeaturesResponse = {
  message: string;
  transaction_id: string;
  status: "pending_confirmation";
  summary?: any;
};

export type ConfirmExtractionResponse = {
  success: boolean;
  message: string;
  transaction_id: string;
};

export type TextileExtractionResult = {
  // Garment / product catalog
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

  // Raw internal fields
  face_raw?: {
    estimated_age_range?: string | null;
    skin_tone?: string | null;
    hair_color?: string | null;
    hair_style?: string | null;
    eye_color?: string | null;
    facial_features?: string[];
  } | null;
  body_raw?: {
    body_type?: string | null;
    estimated_height?: string | null;
    pose?: string | null;
    skin_tone?: string | null;
  } | null;
  model_characteristics?: {
    gender_presentation?: string | null;
    styling?: string | null;
    overall_vibe?: string | null;
    shot_type?: string | null;
  } | null;
};

/**
 * Hook to initiate textile feature extraction for one or more media files
 */
export const useExtractTextileFeatures = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ExtractFeaturesRequest) => {
      // Use native fetch to avoid double-stringification
      const response = await fetch("/admin/medias/extract-features", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to initiate extraction");
      }

      return response.json() as Promise<ExtractFeaturesResponse>;
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to initiate extraction";
      toast.error(message);
      console.error("[useExtractTextileFeatures] Error:", error);
    },
  });
};

/**
 * Hook to confirm a pending textile extraction transaction
 */
export const useConfirmExtraction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (transactionId: string) => {
      const response = await fetch(
        `/admin/medias/extract-features/${transactionId}/confirm`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to confirm extraction");
      }

      return response.json() as Promise<ConfirmExtractionResponse>;
    },
    onSuccess: (data) => {
      toast.success(data.message || "Extraction confirmed and started");
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to confirm extraction";
      toast.error(message);
      console.error("[useConfirmExtraction] Error:", error);
    },
  });
};

/**
 * Hook to extract features from multiple media files in batch
 */
export const useBatchExtractTextileFeatures = () => {
  const extractMutation = useExtractTextileFeatures();
  const confirmMutation = useConfirmExtraction();

  return useMutation({
    mutationFn: async ({
      media_ids,
      hints,
      gender,
      persist,
      autoConfirm = true,
    }: {
      media_ids: string[];
      hints?: string[];
      gender?: "female" | "male" | "unisex";
      persist?: boolean;
      autoConfirm?: boolean;
    }) => {
      const results: Array<{
        media_id: string;
        transaction_id?: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const media_id of media_ids) {
        try {
          const extractResult = await extractMutation.mutateAsync({
            media_id,
            hints,
            gender,
            persist,
          });

          results.push({
            media_id,
            transaction_id: extractResult.transaction_id,
            success: true,
          });

          // Auto-confirm if requested
          if (autoConfirm && extractResult.transaction_id) {
            await confirmMutation.mutateAsync(extractResult.transaction_id);
          }
        } catch (error: any) {
          results.push({
            media_id,
            success: false,
            error: error?.message || "Unknown error",
          });
        }
      }

      return results;
    },
    onSuccess: (results, variables) => {
      const successCount = results.filter((r) => r.success).length;
      const totalCount = results.length;

      if (successCount === totalCount) {
        toast.success(
          `Successfully initiated extraction for ${successCount} ${
            successCount === 1 ? "item" : "items"
          }`
        );
      } else {
        toast.warning(
          `Extraction initiated for ${successCount}/${totalCount} items`
        );
      }
    },
    onError: (error: any) => {
      toast.error("Failed to initiate batch extraction");
      console.error("[useBatchExtractTextileFeatures] Error:", error);
    },
  });
};

// ============================================
// Folder-wide (rate-limited) extraction hooks
// ============================================

export type ExtractFolderFeaturesRequest = {
  hints?: string[];
  gender?: "female" | "male" | "unisex";
  persist?: boolean;
  /** Milliseconds between photos. Default 60000 (1 photo per minute). */
  interval_ms?: number;
};

export type ExtractFolderFeaturesResponse = {
  message: string;
  transaction_id: string;
  status: "pending_confirmation";
  folder_id: string;
  total_images?: number;
  summary?: any;
};

export type ConfirmFolderExtractionResponse = {
  success: boolean;
  message: string;
  transaction_id: string;
};

export type FolderExtractionProgress = {
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
};

export type ExtractFolderFeaturesStatusResponse = {
  folder_id: string;
  has_run: boolean;
  progress: FolderExtractionProgress | null;
};

/**
 * Hook to initiate folder-wide feature extraction.
 * Runs as a long-running workflow processing 1 photo per minute
 * (configurable via interval_ms) to avoid AI rate limits.
 */
export const useExtractFolderFeatures = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      folderId,
      ...payload
    }: ExtractFolderFeaturesRequest & { folderId: string }) => {
      const response = await fetch(
        `/admin/medias/folder/${folderId}/extract-features`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to initiate folder extraction");
      }

      return response.json() as Promise<ExtractFolderFeaturesResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: mediaFolderDetailQueryKeys.all,
      });
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to initiate folder extraction";
      toast.error(message);
      console.error("[useExtractFolderFeatures] Error:", error);
    },
  });
};

/**
 * Hook to confirm a pending folder extraction transaction
 */
export const useConfirmFolderExtraction = () => {
  return useMutation({
    mutationFn: async ({
      folderId,
      transactionId,
    }: {
      folderId: string;
      transactionId: string;
    }) => {
      const response = await fetch(
        `/admin/medias/folder/${folderId}/extract-features/${transactionId}/confirm`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to confirm folder extraction");
      }

      return response.json() as Promise<ConfirmFolderExtractionResponse>;
    },
    onSuccess: (data) => {
      toast.success(data.message || "Folder extraction confirmed and started");
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to confirm folder extraction";
      toast.error(message);
      console.error("[useConfirmFolderExtraction] Error:", error);
    },
  });
};

/**
 * Hook to poll folder extraction progress (from folder metadata)
 */
export const useFolderExtractionStatus = (
  folderId: string | undefined,
  options?: {
    refetchInterval?: number | false | ((query: any) => number | false | undefined)
    enabled?: boolean
  }
) => {
  return useQuery({
    queryKey: ["folder-extraction-status", folderId],
    queryFn: async (): Promise<ExtractFolderFeaturesStatusResponse> => {
      const response = await fetch(
        `/admin/medias/folder/${folderId}/extract-features/status`
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch folder extraction status");
      }
      return response.json();
    },
    enabled: !!folderId && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval,
  });
};
