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
import { Tag } from "./personandtype";
import { personsQueryKeys } from "./persons";

// Define types for tag operations
export interface TagsResponse {
  tags: Tag[];
}

export interface TagInput {
  name: string[];
}

// Define query keys
const PERSON_TAGS_QUERY_KEY = "person-tags" as const;
export const personTagsQueryKeys = {
  ...queryKeysFactory(PERSON_TAGS_QUERY_KEY),
  list: (personId?: string) => [
    ...queryKeysFactory(PERSON_TAGS_QUERY_KEY).lists(),
    personId,
  ],
};

/**
 * Hook for fetching all tags for a person
 */
export const usePersonTags = (
  personId: string,
  options?: Omit<
    UseQueryOptions<
      TagsResponse,
      FetchError,
      TagsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: personTagsQueryKeys.list(personId),
    queryFn: async () =>
      sdk.client.fetch<TagsResponse>(`/admin/persons/${personId}/tags`, {
        method: "GET",
      }),
    ...options,
  });

  return {
    ...rest,
    tags: data?.tags || [],
  };
};

/**
 * Hook for adding tags to a person
 */
export const useAddTagsToPerson = (
  personId: string,
  options?: Omit<
    UseMutationOptions<
      TagsResponse,
      FetchError,
      TagInput
    >,
    "mutationFn"
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TagInput) =>
      sdk.client.fetch<TagsResponse>(`/admin/persons/${personId}/tags`, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      // Invalidate both the tags list and the person details
      queryClient.invalidateQueries({
        queryKey: personTagsQueryKeys.list(personId),
      });
      
      // Also invalidate the person query to ensure person details are up-to-date
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      })
    },
    ...options,
  });
};

/**
 * Hook for updating tags for a person
 */
export const useUpdatePersonTags = (
  personId: string,
  options?: Omit<
    UseMutationOptions<
      TagsResponse,
      FetchError,
      TagInput
    >,
    "mutationFn"
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TagInput) =>
      sdk.client.fetch<TagsResponse>(`/admin/persons/${personId}/tags`, {
        method: "PUT",
        body: data,
      }),
    onSuccess: () => {
      // Invalidate both the tags list and the person details
      queryClient.invalidateQueries({
        queryKey: personTagsQueryKeys.list(personId),
      });
      
      // Also invalidate the person query to ensure person details are up-to-date
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      });
    },
    ...options,
  });
};

/**
 * Hook for deleting a tag from a person
 */
export const useDeletePersonTag = (
  personId: string,
  options?: Omit<
    UseMutationOptions<
      void,
      FetchError,
      string
    >,
    "mutationFn"
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tagId: string): Promise<void> => {
      await sdk.client.fetch(`/admin/persons/${personId}/tags/${tagId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        }
      });
    },
    onSuccess: () => {
      // Invalidate both the tags list and the person details
      queryClient.invalidateQueries({
        queryKey: personTagsQueryKeys.list(personId),
      });
      
      // Also invalidate the person query to ensure person details are up-to-date
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      });
    },
    ...options,
  });
};
