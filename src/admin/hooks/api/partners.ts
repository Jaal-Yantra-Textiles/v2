import { FetchError } from "@medusajs/js-sdk";
import {
  useQuery,
  UseQueryOptions,
  QueryKey,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

export interface AdminPartner {
  id: string;
  partner_id: string;
  name: string;
  handle: string;
  logo?: string;
  status: 'active' | 'inactive' | 'pending';
  is_verified: boolean;
  metadata?: any;
  created_at: string;
  updated_at: string;
}

export interface AdminPartnersResponse {
  partners: AdminPartner[];
  count: number;
  offset: number;
  limit: number;
}

export interface AdminPartnersQuery {
  offset?: number;
  limit?: number;
  q?: string;
  name?: string;
  handle?: string;
  status?: 'active' | 'inactive' | 'pending';
  is_verified?: 'true' | 'false';
  fields?: string[];
}

const PARTNERS_QUERY_KEY = "partners" as const;
export const partnersQueryKeys = queryKeysFactory(PARTNERS_QUERY_KEY);

export const usePartners = (
  query?: AdminPartnersQuery,
  options?: Omit<
    UseQueryOptions<AdminPartnersResponse, FetchError, AdminPartnersResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<AdminPartnersResponse>(`/admin/persons/partner`, {
        method: "GET",
        query: {
          ...query,
          fields: query?.fields ? query.fields.join(",") : undefined,
        },
      }) as Promise<AdminPartnersResponse>,
    queryKey: partnersQueryKeys.list(query),
    ...options,
  });
  return { ...data, ...rest };
};
