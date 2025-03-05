import { FetchError } from "@medusajs/js-sdk";
import {  PaginatedResponse } from "@medusajs/types";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { sdk } from "../../lib/sdk";
import { queryKeysFactory } from "../../lib/query-key-factory";

export interface ColorPalette {
  name: string;
  code: string;
}

export interface FeedbackHistory {
  date: string | Date;
  feedback: string;
  author: string;
}

export interface CustomSize {
  [key: string]: {
    [measurement: string]: number;
  };
}

export interface DesignMedia {
  id?: string;
  url: string;
  isThumbnail?: boolean;
}

export interface AdminDesign {
  id: string;
  name: string;
  description?: string;
  inspiration_sources?: string[];
  design_type?: "Original" | "Derivative" | "Custom" | "Collaboration";
  status?: "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold";
  priority?: "Low" | "Medium" | "High" | "Urgent";
  target_completion_date: string | Date;
  design_files?: string[];
  thumbnail_url?: string;
  custom_sizes?: CustomSize;
  color_palette?: ColorPalette[];
  tags?: string[];
  estimated_cost?: number;
  designer_notes?: string;
  feedback_history?: FeedbackHistory[];
  media_files?: DesignMedia[];
  metadata?: Record<string, any> | null | undefined;
  created_at?: Date;
  updated_at?: Date;
}

export type CreateAdminDesignPayload = Omit<AdminDesign, "id" | "created_at" | "updated_at">;
export type UpdateAdminDesignPayload = Partial<CreateAdminDesignPayload>;

export interface AdminDesignResponse {
  design: AdminDesign;
}

export interface AdminDesignsResponse {
  designs: AdminDesign[];
  count: number;
  offset: number;
  limit: number;
}

export interface AdminDesignsQuery {
  offset?: number;
  limit?: number;
  name?: string;
  design_type?: AdminDesign["design_type"];
  status?: AdminDesign["status"];
  priority?: AdminDesign["priority"];
  tags?: string[];
  q?: string;
}

const DESIGN_QUERY_KEY = "designs" as const;
export const designQueryKeys = queryKeysFactory(DESIGN_QUERY_KEY);

export interface DesignQuery {
  fields?: string[];
}

export const useDesign = (
  id: string,
  query?: DesignQuery,
  options?: Omit<
    UseQueryOptions<
      AdminDesignResponse,
      FetchError,
      AdminDesignResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: designQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs/${id}`, {
        method: "GET",
        query: {
          ...query,
          fields: query?.fields ? query.fields.join(",") : undefined,
        },
      }),
    ...options,
  });
  return { ...data, ...rest };
};

export const useDesigns = (
  query?: AdminDesignsQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminDesignsResponse>,
      FetchError,
      PaginatedResponse<AdminDesignsResponse>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminDesignsResponse>>(
        `/admin/designs`,
        {
          method: "GET",
          query,
        },
      ),
    queryKey: designQueryKeys.list(query),
    ...options,
  });
  return { ...data, ...rest };
};

export const useCreateDesign = (
  options?: UseMutationOptions<
    AdminDesignResponse,
    FetchError,
    CreateAdminDesignPayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateAdminDesignPayload) =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useUpdateDesign = (
  id: string,
  options?: UseMutationOptions<
    AdminDesignResponse,
    FetchError,
    UpdateAdminDesignPayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateAdminDesignPayload) =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs/${id}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useDeleteDesign = (
  id: string,
  options?: UseMutationOptions<AdminDesign, FetchError, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminDesign>(`/admin/designs/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: designQueryKeys.detail(id),
      });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export interface LinkDesignInventoryPayload {
  inventoryIds: string[];
}

export interface DesignInventoryResponse {
  inventory_items: string[];
}

export const useDesignInventory = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      DesignInventoryResponse,
      FetchError,
      DesignInventoryResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  return useQuery({
    queryKey: designQueryKeys.detail(id, ["inventory"]),
    queryFn: async () =>
      sdk.client.fetch<DesignInventoryResponse>(`/admin/designs/${id}/inventory`, {
        method: "GET",
      }),
    ...options,
  });
};

export const useLinkDesignInventory = (
  id: string,
  options?: UseMutationOptions<
    AdminDesignResponse,
    FetchError,
    LinkDesignInventoryPayload
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: LinkDesignInventoryPayload) =>
      sdk.client.fetch<AdminDesignResponse>(`/admin/designs/${id}/inventory`, {
        method: "POST",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(id) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
