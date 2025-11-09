import { FetchError } from "@medusajs/js-sdk";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

export interface AdminFeedback {
  id: string;
  rating: "one" | "two" | "three" | "four" | "five";
  comment?: string;
  status: "pending" | "reviewed" | "resolved";
  submitted_by: string;
  submitted_at: Date | string;
  reviewed_by?: string;
  reviewed_at?: Date | string;
  metadata?: Record<string, any>;
  created_at?: Date;
  updated_at?: Date;
  // Linked entities (when included)
  partner?: any;
  tasks?: any[];
  inventory_orders?: any[];
}

export type CreateAdminFeedbackPayload = Omit<
  AdminFeedback,
  "id" | "created_at" | "updated_at"
>;
export type UpdateAdminFeedbackPayload = Partial<CreateAdminFeedbackPayload>;

export interface AdminFeedbackResponse {
  feedback: AdminFeedback;
}

export interface AdminFeedbacksResponse {
  feedbacks: AdminFeedback[];
  count: number;
  offset?: number;
  limit?: number;
}

export interface AdminFeedbacksQuery {
  offset?: number;
  limit?: number;
  rating?: AdminFeedback["rating"];
  status?: AdminFeedback["status"];
  submitted_by?: string;
  reviewed_by?: string;
  include_partners?: boolean;
  include_tasks?: boolean;
  include_inventory_orders?: boolean;
}

const FEEDBACKS_QUERY_KEY = "feedbacks" as const;
export const feedbacksQueryKeys = queryKeysFactory(FEEDBACKS_QUERY_KEY);

/**
 * Hook to fetch a single feedback by ID
 */
export const useFeedback = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      AdminFeedbackResponse,
      FetchError,
      AdminFeedbackResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: feedbacksQueryKeys.detail(id),
    queryFn: async () => {
      const res = await sdk.client.fetch<AdminFeedbackResponse>(
        `/admin/feedbacks/${id}`
      );
      return res;
    },
    ...options,
  });

  return { ...data, ...rest };
};

/**
 * Hook to fetch all feedbacks with optional filters
 */
export const useFeedbacks = (
  query?: AdminFeedbacksQuery,
  options?: Omit<
    UseQueryOptions<
      AdminFeedbacksResponse,
      FetchError,
      AdminFeedbacksResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: feedbacksQueryKeys.list(query),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      
      if (query?.offset !== undefined) {
        searchParams.append("offset", query.offset.toString());
      }
      if (query?.limit !== undefined) {
        searchParams.append("limit", query.limit.toString());
      }
      if (query?.rating) {
        searchParams.append("rating", query.rating);
      }
      if (query?.status) {
        searchParams.append("status", query.status);
      }
      if (query?.submitted_by) {
        searchParams.append("submitted_by", query.submitted_by);
      }
      if (query?.reviewed_by) {
        searchParams.append("reviewed_by", query.reviewed_by);
      }
      if (query?.include_partners) {
        searchParams.append("include_partners", "true");
      }
      if (query?.include_tasks) {
        searchParams.append("include_tasks", "true");
      }
      if (query?.include_inventory_orders) {
        searchParams.append("include_inventory_orders", "true");
      }

      const queryString = searchParams.toString();
      const url = `/admin/feedbacks${queryString ? `?${queryString}` : ""}`;
      
      const res = await sdk.client.fetch<AdminFeedbacksResponse>(url);
      return res;
    },
    ...options,
  });

  return { ...data, ...rest };
};

/**
 * Hook to fetch feedbacks for a specific partner
 */
export const usePartnerFeedbacks = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<
      AdminFeedbacksResponse,
      FetchError,
      AdminFeedbacksResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: feedbacksQueryKeys.list({ partner_id: partnerId }),
    queryFn: async () => {
      const res = await sdk.client.fetch<AdminFeedbacksResponse>(
        `/admin/partners/${partnerId}/feedbacks`
      );
      return res;
    },
    ...options,
  });

  return { ...data, ...rest };
};

/**
 * Hook to fetch feedbacks for a specific task
 */
export const useTaskFeedbacks = (
  taskId: string,
  options?: Omit<
    UseQueryOptions<
      AdminFeedbacksResponse,
      FetchError,
      AdminFeedbacksResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: feedbacksQueryKeys.list({ task_id: taskId }),
    queryFn: async () => {
      const res = await sdk.client.fetch<AdminFeedbacksResponse>(
        `/admin/tasks/${taskId}/feedbacks`
      );
      return res;
    },
    ...options,
  });

  return { ...data, ...rest };
};

/**
 * Hook to fetch feedbacks for a specific inventory order
 */
export const useInventoryOrderFeedbacks = (
  orderId: string,
  options?: Omit<
    UseQueryOptions<
      AdminFeedbacksResponse,
      FetchError,
      AdminFeedbacksResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: feedbacksQueryKeys.list({ inventory_order_id: orderId }),
    queryFn: async () => {
      const res = await sdk.client.fetch<AdminFeedbacksResponse>(
        `/admin/inventory-orders/${orderId}/feedbacks`
      );
      return res;
    },
    ...options,
  });

  return { ...data, ...rest };
};

/**
 * Hook to create a new feedback
 */
export const useCreateFeedback = (
  options?: UseMutationOptions<
    AdminFeedbackResponse,
    FetchError,
    CreateAdminFeedbackPayload
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateAdminFeedbackPayload) => {
      const res = await sdk.client.fetch<AdminFeedbackResponse>(
        `/admin/feedbacks`,
        {
          method: "POST",
          body: payload,
        }
      );
      return res;
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: feedbacksQueryKeys.lists() });
      toast.success("Feedback created successfully");
      options?.onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      toast.error("Failed to create feedback", {
        description: error.message,
      });
      options?.onError?.(error, variables, context);
    },
    ...options,
  });
};

/**
 * Hook to create feedback for a partner
 */
export const useCreatePartnerFeedback = (
  partnerId: string,
  options?: UseMutationOptions<
    AdminFeedbackResponse,
    FetchError,
    CreateAdminFeedbackPayload
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateAdminFeedbackPayload) => {
      const res = await sdk.client.fetch<AdminFeedbackResponse>(
        `/admin/partners/${partnerId}/feedbacks`,
        {
          method: "POST",
          body: payload,
        }
      );
      return res;
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: feedbacksQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

/**
 * Hook to create feedback for a task
 */
export const useCreateTaskFeedback = (
  taskId: string,
  options?: UseMutationOptions<
    AdminFeedbackResponse,
    FetchError,
    CreateAdminFeedbackPayload
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateAdminFeedbackPayload) => {
      const res = await sdk.client.fetch<AdminFeedbackResponse>(
        `/admin/tasks/${taskId}/feedbacks`,
        {
          method: "POST",
          body: payload,
        }
      );
      return res;
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: feedbacksQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

/**
 * Hook to create feedback for an inventory order
 */
export const useCreateInventoryOrderFeedback = (
  orderId: string,
  options?: UseMutationOptions<
    AdminFeedbackResponse,
    FetchError,
    CreateAdminFeedbackPayload
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateAdminFeedbackPayload) => {
      const res = await sdk.client.fetch<AdminFeedbackResponse>(
        `/admin/inventory-orders/${orderId}/feedbacks`,
        {
          method: "POST",
          body: payload,
        }
      );
      return res;
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: feedbacksQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

/**
 * Hook to update a feedback
 */
export const useUpdateFeedback = (
  id: string,
  options?: UseMutationOptions<
    AdminFeedbackResponse,
    FetchError,
    UpdateAdminFeedbackPayload
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateAdminFeedbackPayload) => {
      const res = await sdk.client.fetch<AdminFeedbackResponse>(
        `/admin/feedbacks/${id}`,
        {
          method: "POST",
          body: payload,
        }
      );
      return res;
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: feedbacksQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedbacksQueryKeys.detail(id) });
      toast.success("Feedback updated successfully");
      options?.onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      toast.error("Failed to update feedback", {
        description: error.message,
      });
      options?.onError?.(error, variables, context);
    },
    ...options,
  });
};

/**
 * Hook to delete a feedback
 */
export const useDeleteFeedback = (
  id: string,
  options?: UseMutationOptions<void, FetchError, void>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await sdk.client.fetch(`/admin/feedbacks/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: feedbacksQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: feedbacksQueryKeys.detail(id) });
      toast.success("Feedback deleted successfully");
      options?.onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      toast.error("Failed to delete feedback", {
        description: error.message,
      });
      options?.onError?.(error, variables, context);
    },
    ...options,
  });
};
