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

// Define types for contact details
export interface ContactDetail {
  id: string;
  phone_number: string;
  type: "mobile" | "home" | "work";
  created_at?: string;
  updated_at?: string;
}

export interface ContactInput {
  phone_number: string;
  type: "mobile" | "home" | "work";
}

export interface ContactUpdateInput extends Partial<ContactInput> {}

export interface ContactsResponse {
  contacts: ContactDetail[];
  count: number;
}

// Define query keys
const PERSON_CONTACTS_QUERY_KEY = "person-contacts" as const;
export const personContactsQueryKeys = {
  ...queryKeysFactory(PERSON_CONTACTS_QUERY_KEY),
  list: (personId?: string, query?: any) => [
    ...queryKeysFactory(PERSON_CONTACTS_QUERY_KEY).lists(),
    personId,
    query,
  ],
};

/**
 * Hook for fetching all contacts for a person
 */
export const usePersonContacts = (
  personId: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      { contacts: ContactDetail[], count: number },
      FetchError,
      { contacts: ContactDetail[], count: number },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: personContactsQueryKeys.list(personId),
    queryFn: async () =>
      sdk.client.fetch<ContactsResponse>(`/admin/persons/${personId}/contacts`, {
        method: "GET",
        query,
      }),
    ...options,
  });

  return {
    ...rest,
    contacts: data?.contacts || [],
    count: data?.count || 0,
  };
};

/**
 * Hook for adding a contact to a person
 */
export const useAddContactToPerson = (
  personId: string,
  options?: UseMutationOptions<
    { contact: ContactDetail },
    FetchError,
    ContactInput
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ContactInput) =>
      sdk.client.fetch<{ contact: ContactDetail }>(`/admin/persons/${personId}/contacts`, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: personContactsQueryKeys.list(personId),
      });
    },
    ...options,
  });
};

/**
 * Hook for updating a contact
 */
export const useUpdatePersonContact = (
  personId: string,
  contactId: string,
  options?: UseMutationOptions<
    { contact: ContactDetail },
    FetchError,
    ContactUpdateInput
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ContactUpdateInput) =>
      sdk.client.fetch<{ contact: ContactDetail }>(`/admin/persons/${personId}/contacts/${contactId}`, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: personContactsQueryKeys.list(personId),
      });
    },
    ...options,
  });
};

/**
 * Hook for deleting a contact
 */
export const useDeletePersonContact = (
  personId: string,
  contactId: string,
  options?: UseMutationOptions<void, FetchError, void>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      await sdk.client.fetch(`/admin/persons/${personId}/contacts/${contactId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: personContactsQueryKeys.list(personId),
      });
    },
    ...options,
  });
};
