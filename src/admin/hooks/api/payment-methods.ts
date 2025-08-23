import { FetchError } from "@medusajs/js-sdk";
import { keepPreviousData, QueryKey, UseMutationOptions, UseQueryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";
import { partnersQueryKeys as adminPartnersQueryKeys } from "./partners-admin";
import { personsQueryKeys } from "./persons";

const PAYMENT_METHODS_QUERY_KEY = "payment-methods" as const;
export const paymentMethodsQueryKeys = queryKeysFactory(PAYMENT_METHODS_QUERY_KEY);

export type AdminPaymentMethod = Record<string, any>;

export const useListPersonPaymentMethods = (
  personId: string,
  query?: Record<string, any>,
  options?: Omit<UseQueryOptions<{ paymentMethods: AdminPaymentMethod[]; count: number; offset: number; limit: number }, FetchError, { paymentMethods: AdminPaymentMethod[]; count: number; offset: number; limit: number }, QueryKey>, "queryFn" | "queryKey">
) => {
  const { data, ...rest } = useQuery({
    queryKey: [PAYMENT_METHODS_QUERY_KEY, "person", personId, query],
    queryFn: async () =>
      sdk.client.fetch<{ paymentMethods: AdminPaymentMethod[]; count: number; offset: number; limit: number }>(
        `/admin/payments/persons/${personId}/methods`,
        { method: "GET", query }
      ),
    placeholderData: keepPreviousData,
    ...options,
  });
  return { ...(data || {}), ...rest };
};

export const useCreatePersonPaymentMethod = (
  personId: string,
  options?: UseMutationOptions<{ paymentMethod: AdminPaymentMethod }, FetchError, Record<string, any>>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, any>) =>
      sdk.client.fetch<{ paymentMethod: AdminPaymentMethod }>(
        `/admin/payments/persons/${personId}/methods`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: [PAYMENT_METHODS_QUERY_KEY, "person", personId] });
      // Invalidate person details (all variants) and specific person detail
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() });
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.detail(personId) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useListPartnerPaymentMethods = (
  partnerId: string,
  query?: Record<string, any>,
  options?: Omit<UseQueryOptions<{ paymentMethods: AdminPaymentMethod[]; count: number; offset: number; limit: number }, FetchError, { paymentMethods: AdminPaymentMethod[]; count: number; offset: number; limit: number }, QueryKey>, "queryFn" | "queryKey">
) => {
  const { data, ...rest } = useQuery({
    queryKey: [PAYMENT_METHODS_QUERY_KEY, "partner", partnerId, query],
    queryFn: async () =>
      sdk.client.fetch<{ paymentMethods: AdminPaymentMethod[]; count: number; offset: number; limit: number }>(
        `/admin/payments/partners/${partnerId}/methods`,
        { method: "GET", query }
      ),
    placeholderData: keepPreviousData,
    ...options,
  });
  return { ...(data || {}), ...rest };
};

export const useCreatePartnerPaymentMethod = (
  partnerId: string,
  options?: UseMutationOptions<{ paymentMethod: AdminPaymentMethod }, FetchError, Record<string, any>>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, any>) =>
      sdk.client.fetch<{ paymentMethod: AdminPaymentMethod }>(
        `/admin/payments/partners/${partnerId}/methods`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      // List of payment methods for this partner
      queryClient.invalidateQueries({ queryKey: [PAYMENT_METHODS_QUERY_KEY, "partner", partnerId] });
      // Invalidate partner detail queries (all variants + specific)
      queryClient.invalidateQueries({ queryKey: adminPartnersQueryKeys.details() });
      queryClient.invalidateQueries({ queryKey: adminPartnersQueryKeys.detail(partnerId) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
