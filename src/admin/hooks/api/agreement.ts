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

export type AdminAgreement = {
  id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date | null;
  [key: string]: any;
};

export type CreateAdminAgreementPayload = {
  [key: string]: any;
};

export type CreateAdminAgreementsPayload = {
  agreement: CreateAdminAgreementPayload[];
};

export type CreateAgreementsPayload = CreateAdminAgreementPayload | CreateAdminAgreementsPayload;

export type UpdateAdminAgreementPayload = Partial<CreateAdminAgreementPayload>;

export interface AdminAgreementResponse {
  agreement: AdminAgreement;
}

export interface AdminAgreementsResponse {
  agreements: AdminAgreement[];
  count: number;
  offset: number;
  limit: number;
}

export interface AdminAgreementsQuery {
  q?: string;
  offset?: number;
  limit?: number;
  [key: string]: any;
}

const AGREEMENT_QUERY_KEY = "agreement" as const;
export const agreementQueryKeys = queryKeysFactory(AGREEMENT_QUERY_KEY);

export const useAgreement = (
  agreementId: string,
  options?: Omit<
    UseQueryOptions<AdminAgreementResponse, FetchError, AdminAgreementResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: agreementQueryKeys.detail(agreementId),
    queryFn: async () =>
      sdk.client.fetch<AdminAgreementResponse>(
        `/admin/agreements/${agreementId}`,
        {
          method: "GET",
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};

export const useAgreements = (
  query?: AdminAgreementsQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminAgreementsResponse>,
      FetchError,
      PaginatedResponse<AdminAgreementsResponse>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: agreementQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminAgreementsResponse>>(
        `/admin/agreements`,
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};

export const useCreateAgreement = (
  options?: UseMutationOptions<
    AdminAgreementResponse,
    FetchError,
    CreateAgreementsPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<AdminAgreementResponse>(
        `/admin/agreements`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: agreementQueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useUpdateAgreement = (
  agreementId: string,
  options?: UseMutationOptions<
    AdminAgreementResponse,
    FetchError,
    UpdateAdminAgreementPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<AdminAgreementResponse>(
        `/admin/agreements/${agreementId}`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: agreementQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: agreementQueryKeys.detail(agreementId) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useDeleteAgreement = (
  agreementId: string,
  options?: UseMutationOptions<AdminAgreement, FetchError, void>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminAgreement>(
        `/admin/agreements/${agreementId}`,
        {
          method: "DELETE",
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: agreementQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: agreementQueryKeys.detail(agreementId) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};