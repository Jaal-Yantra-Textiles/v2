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
import { AddressInput } from "./personandtype";
import { AddressDetails } from "./personandtype";
import { personsQueryKeys } from "./persons";

const PERSON_ADDRESSES_QUERY_KEY = "person_addresses" as const;
export const personAddressesQueryKeys = queryKeysFactory(
  PERSON_ADDRESSES_QUERY_KEY
);

interface AddressesResponse {
  addresses: AddressDetails[];
  count: number;
}

export const usePersonAddresses = (
  personId: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AddressesResponse,
      FetchError,
      AddressesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: personAddressesQueryKeys.list(personId),
    queryFn: async () =>
      sdk.client.fetch<AddressesResponse>(
        `/admin/persons/${personId}/addresses`,
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  });

  return {
    ...rest,
    addresses: data?.addresses || [],
    count: data?.count || 0,
  };
};

export const useUpdatePersonAddress = (
  personId: string,
  addressId: string,
  options?: UseMutationOptions<{ address: AddressDetails }, FetchError, AddressInput>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: AddressInput) =>
      sdk.client.fetch<{ address: AddressDetails }>(
        `/admin/persons/${personId}/addresses/${addressId}`,
        {
          method: "POST",
          body: data,
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: personAddressesQueryKeys.list(personId),
      });
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      });
    },
    ...options,
  });
};
