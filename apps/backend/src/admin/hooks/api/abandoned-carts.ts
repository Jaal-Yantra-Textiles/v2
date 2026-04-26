import { FetchError } from "@medusajs/js-sdk";
import {
  QueryKey,
  UseQueryOptions,
  useQuery,
} from "@tanstack/react-query";

import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

export type AbandonedCartTier = "all" | "has_items" | "recoverable" | "checkout";

export type AbandonedCartItemPreview = {
  id: string;
  title: string | null;
  quantity: number;
  unit_price: number;
  thumbnail: string | null;
};

export type AbandonedCartListItem = {
  id: string;
  email: string | null;
  currency_code: string;
  created_at: string;
  updated_at: string;
  idle_minutes: number;
  items_count: number;
  items_subtotal: number;
  items_preview: AbandonedCartItemPreview[];
  customer: {
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
  sales_channel: { id: string; name: string } | null;
  region: { id: string; name: string } | null;
  has_shipping_address: boolean;
  recovery_email_sent_at: string | null;
};

export type AbandonedCartsQuery = {
  tier?: AbandonedCartTier;
  idle_minutes?: number;
  q?: string;
  sales_channel_id?: string;
  region_id?: string;
  customer_id?: string;
  email?: string;
  has_shipping?: "yes" | "no";
  offset?: number;
  limit?: number;
  order?: string;
};

export type AbandonedCartsResponse = {
  abandoned_carts: AbandonedCartListItem[];
  count: number;
  offset: number;
  limit: number;
  tier: AbandonedCartTier;
  idle_minutes: number;
};

export type AbandonedCartDetail = {
  id: string;
  email: string | null;
  customer_id: string | null;
  region_id: string | null;
  sales_channel_id: string | null;
  currency_code: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any> | null;
  items: Array<{
    id: string;
    title: string;
    quantity: number;
    unit_price: number;
    thumbnail: string | null;
    product_id: string | null;
    variant_id: string | null;
    [key: string]: any;
  }>;
  shipping_address: Record<string, any> | null;
  billing_address: Record<string, any> | null;
  shipping_methods: Array<Record<string, any>>;
  promotions: Array<Record<string, any>>;
  customer: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  } | null;
  region: { id: string; name: string; currency_code: string } | null;
  sales_channel: { id: string; name: string } | null;
  items_count: number;
  items_subtotal: number;
  idle_minutes: number;
  recovery_url: string;
  is_completed: boolean;
};

const abandonedCartsQueryKeys = queryKeysFactory<
  "abandoned_carts",
  AbandonedCartsQuery
>("abandoned_carts");

export { abandonedCartsQueryKeys };

export const useAbandonedCarts = (
  query?: AbandonedCartsQuery,
  options?: Omit<
    UseQueryOptions<
      AbandonedCartsResponse,
      FetchError,
      AbandonedCartsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<AbandonedCartsResponse>(`/admin/abandoned-carts`, {
        method: "GET",
        query: query as Record<string, any>,
      }),
    queryKey: abandonedCartsQueryKeys.list(query),
    ...options,
  });

  return { ...data, ...rest };
};

export const useAbandonedCart = (
  cartId: string,
  options?: Omit<
    UseQueryOptions<
      { abandoned_cart: AbandonedCartDetail },
      FetchError,
      { abandoned_cart: AbandonedCartDetail },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ abandoned_cart: AbandonedCartDetail }>(
        `/admin/abandoned-carts/${cartId}`,
        { method: "GET" },
      ),
    queryKey: abandonedCartsQueryKeys.detail(cartId),
    enabled: Boolean(cartId),
    ...options,
  });

  return { abandonedCart: data?.abandoned_cart, ...rest };
};
