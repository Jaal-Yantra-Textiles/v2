import { FetchError } from "@medusajs/js-sdk";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

export type DesignOrderItem = {
  design: {
    id: string;
    name: string;
    status: string;
  };
  customer: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  } | null;
  line_item_id: string;
  cart_id: string;
  price: number;
  added_at: string;
  order: {
    id: string;
    display_id: number;
    status: string;
    payment_status: string;
    fulfillment_status: string;
    total: number;
    currency_code: string;
    created_at: string;
    canceled_at: string | null;
  } | null;
};

export type DesignOrdersQuery = {
  limit?: number;
  offset?: number;
};

export type DesignOrdersResponse = {
  design_orders: DesignOrderItem[];
  count: number;
  offset: number;
  limit: number;
};

export type ApproveDesignResponse = {
  design: { id: string; status: string };
  product_id: string;
  variant_id: string;
};

const designOrdersQueryKeys = queryKeysFactory<
  "design_orders",
  DesignOrdersQuery
>("design_orders");

export { designOrdersQueryKeys };

export const useDesignOrders = (
  query?: DesignOrdersQuery,
  options?: Omit<
    UseQueryOptions<
      DesignOrdersResponse,
      FetchError,
      DesignOrdersResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<DesignOrdersResponse>(`/admin/designs/orders`, {
        method: "GET",
        query: query as Record<string, any>,
      }),
    queryKey: designOrdersQueryKeys.list(query),
    ...options,
  });

  return { ...data, ...rest };
};

export const useDesignOrder = (
  lineItemId: string,
  options?: Omit<
    UseQueryOptions<
      { design_order: DesignOrderItem },
      FetchError,
      { design_order: DesignOrderItem },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ design_order: DesignOrderItem }>(
        `/admin/designs/orders/${lineItemId}`,
        { method: "GET" }
      ),
    queryKey: designOrdersQueryKeys.detail(lineItemId),
    ...options,
  });

  return { designOrder: data?.design_order, ...rest };
};

export const useApproveDesign = (
  designId: string,
  options?: UseMutationOptions<ApproveDesignResponse, FetchError>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<ApproveDesignResponse>(
        `/admin/designs/${designId}/approve`,
        { method: "POST", body: {} }
      ),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: designOrdersQueryKeys.lists(),
      });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};

export const useCancelDesignOrder = (
  orderId: string,
  options?: UseMutationOptions<unknown, FetchError>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch(`/admin/orders/${orderId}/cancel`, {
        method: "POST",
        body: {},
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: designOrdersQueryKeys.lists(),
      });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};
