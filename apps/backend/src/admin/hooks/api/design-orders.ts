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

export type DesignOrderLineItem = {
  design: {
    id: string;
    name: string;
    status: string;
    estimated_cost?: number;
  };
  line_item_id: string;
  price: number;
  metadata: Record<string, any> | null;
  added_at: string;
};

export type DesignOrderItem = {
  cart_id: string;
  cart: {
    id: string;
    currency_code: string;
    metadata: Record<string, any> | null;
    created_at: string;
    completed_at: string | null;
  } | null;
  customer: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  } | null;
  items: DesignOrderLineItem[];
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
  created_at: string | null;
  total_price: number;
};

/** Single design-order detail (returned by GET /admin/designs/orders/:lineItemId) */
export type DesignOrderDetail = {
  design: {
    id: string;
    name: string;
    status: string;
    description?: string;
    thumbnail_url?: string;
    estimated_cost?: number;
    design_type?: string;
  };
  customer: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  } | null;
  line_item_id: string;
  cart_id: string;
  title: string | null;
  price: number;
  quantity: number;
  added_at: string;
  metadata: Record<string, any> | null;
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
    tracking: {
      carrier: string | null;
      awb: string | null;
      tracking_url: string | null;
      current_status: string | null;
      shipped_at: string | null;
      delivered_at: string | null;
    } | null;
  } | null;
  checkout_url: string | null;
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
      { design_order: DesignOrderDetail },
      FetchError,
      { design_order: DesignOrderDetail },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ design_order: DesignOrderDetail }>(
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

export type ConvertDesignOrderPayload = {
  payment_mode?: "prepaid" | "cod";
};

export type ConvertDesignOrderResponse = {
  design_order_conversion: {
    order_id: string;
    display_id?: number;
    status?: string;
    payment_status?: string;
    payment_mode: "prepaid" | "cod";
    linked_design_ids: string[];
  };
};

/**
 * Convert a design order (cart with design line items, no order yet) into a
 * real order. #404 PR-A. Pass `{ payment_mode: "cod" }` to leave it unpaid;
 * defaults to prepaid (marked paid via the system provider).
 */
export const useConvertDesignOrder = (
  lineItemId: string,
  options?: UseMutationOptions<
    ConvertDesignOrderResponse,
    FetchError,
    ConvertDesignOrderPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ConvertDesignOrderPayload = {}) =>
      sdk.client.fetch<ConvertDesignOrderResponse>(
        `/admin/designs/orders/${lineItemId}/convert`,
        { method: "POST", body: payload }
      ),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: designOrdersQueryKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: designOrdersQueryKeys.detail(lineItemId),
      });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};

// #826 S3a — produce a design order: fan out one production run per design line
// and collate them into ONE kind=design work-order. Optional partner_id commits
// the work (runs born sent_to_partner → the work-order is visible to that
// partner). Idempotent.
export interface ProduceDesignOrderPayload {
  partner_id?: string;
}
export interface ProduceDesignOrderResponse {
  design_order_production: {
    created: number;
    run_ids: string[];
    design_ids: string[];
    work_order_id: string | null;
  };
}
export const useProduceDesignOrder = (
  orderId: string,
  options?: UseMutationOptions<
    ProduceDesignOrderResponse,
    FetchError,
    ProduceDesignOrderPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ProduceDesignOrderPayload = {}) =>
      sdk.client.fetch<ProduceDesignOrderResponse>(
        `/admin/orders/${orderId}/design/produce`,
        { method: "POST", body: payload }
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

export type ShiprocketRateOption = {
  courier_id?: string | number;
  courier_name?: string;
  amount: number;
  currency_code: string;
  estimated_days?: number;
  cod_charges?: number;
  is_recommended?: boolean;
};

export type ShiprocketRatesResponse = {
  origin_pincode: string;
  destination_pincode: string;
  weight_grams: number;
  cod: boolean;
  rates: ShiprocketRateOption[];
};

/**
 * List the Shiprocket courier options (rate / ETA / recommended) for an order
 * so the operator can pick a courier before generating the label. #641.
 * Disabled until explicitly enabled (the UI fetches on demand).
 */
export const useShiprocketRates = (
  orderId: string,
  options?: Omit<
    UseQueryOptions<
      ShiprocketRatesResponse,
      FetchError,
      ShiprocketRatesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  return useQuery({
    queryKey: designOrdersQueryKeys.detail(`${orderId}-shiprocket-rates`),
    queryFn: async () =>
      sdk.client.fetch<ShiprocketRatesResponse>(
        `/admin/orders/${orderId}/shiprocket-rates`,
        { method: "GET" }
      ),
    ...options,
  });
};

export type GenerateShiprocketLabelResponse = {
  shiprocket_label: {
    awb?: string;
    tracking_number?: string;
    label_url?: string;
    tracking_url?: string;
    fulfillment_id: string;
  };
};

export type GenerateShiprocketLabelVariables =
  | { preferred_courier_id?: string | number }
  | undefined;

/**
 * One-click Shiprocket label for a converted order: creates a fulfillment (or
 * reuses an existing Shiprocket one) and generates the shipment + label. #404
 * PR-C. Optionally passes the operator-chosen `preferred_courier_id` (#641).
 */
export const useGenerateShiprocketLabel = (
  orderId: string,
  options?: UseMutationOptions<
    GenerateShiprocketLabelResponse,
    FetchError,
    GenerateShiprocketLabelVariables
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables?: GenerateShiprocketLabelVariables) =>
      sdk.client.fetch<GenerateShiprocketLabelResponse>(
        `/admin/orders/${orderId}/shiprocket-label`,
        {
          method: "POST",
          body: variables?.preferred_courier_id
            ? { preferred_courier_id: variables.preferred_courier_id }
            : {},
        }
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

export type AttachShiprocketAwbResponse = {
  shiprocket_awb: {
    awb: string;
    current_status?: string;
    synced_state: "delivered" | "shipped" | "pending";
    fulfillment_id: string;
  };
};

/**
 * Attach an EXISTING Shiprocket AWB (already shipped/delivered outside this
 * system) to a converted order. Read-only against Shiprocket — looks the AWB up,
 * stamps it onto the fulfillment, and auto-syncs the fulfillment status. #437.
 */
export const useAttachShiprocketAwb = (
  orderId: string,
  options?: UseMutationOptions<AttachShiprocketAwbResponse, FetchError, string>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (awb: string) =>
      sdk.client.fetch<AttachShiprocketAwbResponse>(
        `/admin/orders/${orderId}/shiprocket-attach-awb`,
        { method: "POST", body: { awb } }
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
