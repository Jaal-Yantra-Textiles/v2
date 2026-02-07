import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { toast } from "@medusajs/ui";
import { mediaFolderDetailQueryKeys } from "./media-folders/use-media-folder-detail";

/**
 * Request/Response types for textile extraction API
 */
export type ExtractFeaturesRequest = {
  media_id: string;
  hints?: string[];
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
  title: string;
  description: string;
  designer?: string;
  model_name?: string;
  cloth_type?: string;
  pattern?: string;
  fabric_weight?: string;
  care_instructions?: string;
  season?: string;
  occasion?: string;
  colors?: string[];
  category?: string;
  suggested_price?: number;
  seo_keywords?: string[];
  target_audience?: string;
  confidence?: number;
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
      persist,
      autoConfirm = true,
    }: {
      media_ids: string[];
      hints?: string[];
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
