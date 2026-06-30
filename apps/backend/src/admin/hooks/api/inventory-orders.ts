import { FetchError } from "@medusajs/js-sdk";
import { PaginatedResponse } from "@medusajs/types";
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

export interface OrderLine {
  inventory_item_id: string;
  quantity: number;
  price: number;
}

export interface StockLocations {
  id: string,
  name: string, 
  address: {
    id: string
    address_1: string,
    address_2: string,
    company: string,
    phone: string,
    province: string,
    postal_code: string,
    city: string, 
    country_code: string
  }
  address_1: string
  address_2: string
  company: string
  phone: string
  province: string
  postal_code: string
  city: string
  country_code: string
}

export interface AdminInventoryOrder {
  id: string;
  status: string;
  quantity: number;
  total_price: number;
  expected_delivery_date: string;
  order_date: string;
  shipping_address?: Record<string, any>;
  stock_locations: StockLocations[];
  order_lines: OrderLine[];
  is_sample?: boolean;
  tasks?: any[];
  partner?: any;
  metadata?: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
}

export type CreateAdminInventoryOrderPayload = Omit<AdminInventoryOrder, "id" | "created_at" | "updated_at">;
export type UpdateAdminInventoryOrderPayload = Partial<CreateAdminInventoryOrderPayload>;

export interface SendInventoryOrderToPartnerPayload {
  partnerId: string;
  notes?: string;
}

export interface AdminInventoryOrderResponse {
  inventoryOrder: AdminInventoryOrder;
}

export interface AdminInventoryOrdersResponse {
  inventory_orders: AdminInventoryOrder[];
  count: number;
  offset: number;
  limit: number;
}

export interface AdminInventoryOrdersQuery {
  offset?: number;
  limit?: number;
  status?: string;
  quantity?: number;
  order_date?: string;
  expected_delivery_date?: string;
  q?: string;
  // Sort directive, e.g. "order_date:DESC" — parsed server-side by
  // parseOrderParam. Drives the table's default recent-first ordering and
  // column-header sorting (#784).
  order?: string;
}

const INVENTORY_ORDER_QUERY_KEY = "inventory-orders" as const;
export const inventoryOrderQueryKeys = queryKeysFactory(INVENTORY_ORDER_QUERY_KEY);

export interface InventoryOrderQuery {
  fields?: string[];
}

export const useInventoryOrder = (
  id: string,
  query?: InventoryOrderQuery,
  options?: Omit<
    UseQueryOptions<AdminInventoryOrderResponse, FetchError, AdminInventoryOrderResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: inventoryOrderQueryKeys.detail(id, query),
    queryFn: async () =>
      sdk.client.fetch<AdminInventoryOrderResponse>(`/admin/inventory-orders/${id}`, {
        method: "GET",
        query: {
          ...query,
          fields: query?.fields ? query.fields.join(",") : undefined,
        },
      }),
    refetchOnWindowFocus: true,
    staleTime: 0,
    ...options,
  });
  return { ...data, ...rest };
};

export const useInventoryOrders = (
  query?: AdminInventoryOrdersQuery,
  options?: Omit<
    UseQueryOptions<PaginatedResponse<AdminInventoryOrdersResponse>, FetchError, PaginatedResponse<AdminInventoryOrdersResponse>, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminInventoryOrdersResponse>>(
        `/admin/inventory-orders`,
        {
          method: "GET",
          query,
        },
      ),
    queryKey: inventoryOrderQueryKeys.list(query),
    ...options,
  });
  return { ...data, ...rest };
};

export const useCreateInventoryOrder = (
  options?: UseMutationOptions<AdminInventoryOrderResponse, FetchError, CreateAdminInventoryOrderPayload>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateAdminInventoryOrderPayload) =>
      sdk.client.fetch<AdminInventoryOrderResponse>(`/admin/inventory-orders`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.lists() });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};

export const useUpdateInventoryOrder = (
  id: string,
  options?: UseMutationOptions<AdminInventoryOrderResponse, FetchError, UpdateAdminInventoryOrderPayload>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateAdminInventoryOrderPayload) =>
      sdk.client.fetch<AdminInventoryOrderResponse>(`/admin/inventory-orders/${id}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.details() });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};

// #790 slice 3 — mark an order "Ready for Delivery" (Partial → it; completion
// must be recorded first, so raw "Processing" is rejected by the API).
export const useMarkInventoryOrderReadyForDelivery = (
  id: string,
  options?: UseMutationOptions<{ order: AdminInventoryOrder }, FetchError, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<{ order: AdminInventoryOrder }>(`/admin/inventory-orders/${id}/ready-for-delivery`, {
        method: "POST",
        body: {},
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.lists() });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};

export interface CreateInventoryOrderShipmentPayload {
  carrier?: string;
  pickup_stock_location_id?: string;
  weight_grams?: number;
  dimensions_cm?: { length?: number; breadth?: number; height?: number };
  preferred_courier_id?: string | number;
  delivered_quantities?: Record<string, number>;
}

export interface CreateInventoryOrderShipmentResponse {
  shipment?: { awb?: string; tracking_number?: string; label_url?: string; [k: string]: any };
}

// #790 slice 3 — generate a real carrier shipment (AWB + label) for the order.
export const useCreateInventoryOrderShipment = (
  id: string,
  options?: UseMutationOptions<CreateInventoryOrderShipmentResponse, FetchError, CreateInventoryOrderShipmentPayload>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateInventoryOrderShipmentPayload) =>
      sdk.client.fetch<CreateInventoryOrderShipmentResponse>(`/admin/inventory-orders/${id}/shipment`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.lists() });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};

export const useCreateInventoryOrderTasks = (
  id: string,
  options?: UseMutationOptions<any, FetchError, { type: string; template_names: string[]; dependency_type?: string }>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { type: string; template_names: string[]; dependency_type?: string }) =>
      sdk.client.fetch(`/admin/inventory-orders/${id}/tasks`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args) => {
      // invalidate inventory order detail and tasks queries
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.detail(id) });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};

export const useDeleteInventoryOrder = (
  id: string,
  options?: UseMutationOptions<AdminInventoryOrder, FetchError, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminInventoryOrder>(`/admin/inventory-orders/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.lists() });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};

export const useSendInventoryOrderToPartner = (
  id: string,
  options?: UseMutationOptions<any, FetchError, SendInventoryOrderToPartnerPayload>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SendInventoryOrderToPartnerPayload) =>
      sdk.client.fetch<any>(`/admin/inventory-orders/${id}/send-to-partner`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.lists() });
      options?.onSuccess?.(...args);
    },
    ...options,
  });
};

export interface UpdateInventoryOrderLinesPayload {
  id: string;
  data: {
    quantity?: number;
    total_price?: number;
  };
  order_lines: Array<{
    id?: string;
    inventory_item_id: string;
    quantity: number;
    price: number;
  }>;
}

export const useUpdateInventoryOrderLines = (
  options?: UseMutationOptions<AdminInventoryOrderResponse, FetchError, UpdateInventoryOrderLinesPayload>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateInventoryOrderLinesPayload) =>
      sdk.client.fetch<AdminInventoryOrderResponse>(`/admin/inventory-orders/${payload.id}/order-lines`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: async (data, variables, ...args) => {
      // Invalidate all queries related to inventory orders
      await queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.lists() });
      await queryClient.invalidateQueries({ queryKey: inventoryOrderQueryKeys.details() });
      // Force refetch of all active detail queries
      await queryClient.refetchQueries({ 
        queryKey: inventoryOrderQueryKeys.details(),
        type: 'active'
      });
      options?.onSuccess?.(data, variables, ...args);
    },
    ...options,
  });
};
