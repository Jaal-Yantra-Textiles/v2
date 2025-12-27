import { FetchError } from "@medusajs/js-sdk"
import {
  keepPreviousData,
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import {
  PERSON_RESOURCE_META,
  PersonResourceKey,
} from "./person-resource-meta"
import {
  AddressDetails,
  AddressInput,
  ContactDetail,
  ContactInput,
  ContactUpdateInput,
  Tag,
} from "./personandtype"

import { TagInput } from "./person-tags"
import { personsQueryKeys } from "./persons"

export type PersonResourceListApiResponse<TItem> = {
  count?: number
  [key: string]: unknown
}

export type PersonResourceItemApiResponse<TItem> = {
  [key: string]: unknown
}

type ListQueryOptions<TItem> = Omit<
  UseQueryOptions<
    PersonResourceListApiResponse<TItem>,
    FetchError,
    PersonResourceListApiResponse<TItem>,
    QueryKey
  >,
  "queryKey" | "queryFn"
>

type ItemQueryOptions<TItem> = Omit<
  UseQueryOptions<
    PersonResourceItemApiResponse<TItem>,
    FetchError,
    PersonResourceItemApiResponse<TItem>,
    QueryKey
  >,
  "queryKey" | "queryFn"
>

const getPersonResourceQueryKeys = (resourceKey: PersonResourceKey) => {
  const base = ["persons", "resources", resourceKey] as const

  return {
    listScope: (personId: string) => [...base, personId, "list"] as const,
    list: (personId: string, query?: Record<string, any>) =>
      [...base, personId, "list", { query: query ?? {} }] as const,
    detailScope: (personId: string, resourceId: string) =>
      [...base, personId, "detail", resourceId] as const,
  }
}

export const createPersonResourceHooks = <
  TResource,
  TCreatePayload extends Record<string, any> = Record<string, any>,
  TUpdatePayload extends Record<string, any> = Partial<TCreatePayload>,
>(
  resourceKey: PersonResourceKey,
) => {
  const meta = PERSON_RESOURCE_META[resourceKey]
  const queryKeys = getPersonResourceQueryKeys(resourceKey)

  const useResourceList = (
    personId: string,
    query?: Record<string, any>,
    options?: ListQueryOptions<TResource>,
  ) => {
    const { data, ...rest } = useQuery({
      queryKey: queryKeys.list(personId, query),
      queryFn: async () =>
        sdk.client.fetch<PersonResourceListApiResponse<TResource>>(
          `/admin/persons/${personId}/resources/${meta.pathSegment}`,
          {
            method: "GET",
            query,
          },
        ),
      placeholderData: keepPreviousData,
      ...options,
    })

    const items = (data?.[meta.listKey] as TResource[] | undefined) ?? []

    return {
      items,
      count: data?.count,
      ...rest,
    }
  }

  const useResource = (
    personId: string,
    resourceId: string,
    options?: ItemQueryOptions<TResource>,
  ) => {
    const { data, ...rest } = useQuery({
      queryKey: queryKeys.detailScope(personId, resourceId),
      queryFn: async () =>
        sdk.client.fetch<PersonResourceItemApiResponse<TResource>>(
          `/admin/persons/${personId}/resources/${meta.pathSegment}/${resourceId}`,
          {
            method: "GET",
          },
        ),
      placeholderData: keepPreviousData,
      ...options,
    })

    return {
      item: data?.[meta.itemKey] as TResource | undefined,
      ...rest,
    }
  }

  const useCreateResource = (
    personId: string,
    options?: UseMutationOptions<
      PersonResourceItemApiResponse<TResource>,
      FetchError,
      TCreatePayload
    >,
  ) => {
    const queryClient = useQueryClient()

    return useMutation({
      mutationFn: async (payload: TCreatePayload) =>
        sdk.client.fetch<PersonResourceItemApiResponse<TResource>>(
          `/admin/persons/${personId}/resources/${meta.pathSegment}`,
          {
            method: "POST",
            body: payload,
          },
        ),
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.listScope(personId),
          exact: false,
        })

        const resource = data?.[meta.itemKey] as { id?: string } | undefined
        if (resource?.id) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.detailScope(personId, resource.id),
            exact: false,
          })
        }
        queryClient.invalidateQueries({
          queryKey: personsQueryKeys.details(),
          exact: false,
        })

        options?.onSuccess?.(data, variables, context)
      },
      ...options,
    })
  }

  const useUpdateResource = (
    personId: string,
    resourceId: string,
    options?: UseMutationOptions<
      PersonResourceItemApiResponse<TResource>,
      FetchError,
      TUpdatePayload
    >,
  ) => {
    const queryClient = useQueryClient()

    return useMutation({
      mutationFn: async (payload: TUpdatePayload) =>
        sdk.client.fetch<PersonResourceItemApiResponse<TResource>>(
          `/admin/persons/${personId}/resources/${meta.pathSegment}/${resourceId}`,
          {
            method: "PATCH",
            body: payload,
          },
        ),
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.listScope(personId),
          exact: false,
        })
        queryClient.invalidateQueries({
          queryKey: queryKeys.detailScope(personId, resourceId),
          exact: false,
        })
        queryClient.invalidateQueries({
          queryKey: personsQueryKeys.details(),
          exact: false,
        })
        options?.onSuccess?.(data, variables, context)
      },
      ...options,
    })
  }

  const useDeleteResource = (
    personId: string,
    resourceId: string,
    options?: UseMutationOptions<void, FetchError, void>,
  ) => {
    const queryClient = useQueryClient()

    return useMutation({
      mutationFn: async () => {
        await sdk.client.fetch(
          `/admin/persons/${personId}/resources/${meta.pathSegment}/${resourceId}`,
          {
            method: "DELETE",
          },
        )
      },
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.listScope(personId),
          exact: false,
        })
        queryClient.invalidateQueries({
          queryKey: queryKeys.detailScope(personId, resourceId),
          exact: false,
        })
        queryClient.invalidateQueries({
          queryKey: personsQueryKeys.details(),
          exact: false,
        })
        options?.onSuccess?.(data, variables, context)
      },
      ...options,
    })
  }

  const useDeleteResourceById = (
    personId: string,
    options?: UseMutationOptions<void, FetchError, string>,
  ) => {
    const queryClient = useQueryClient()

    return useMutation({
      mutationFn: async (resourceId: string) => {
        await sdk.client.fetch(
          `/admin/persons/${personId}/resources/${meta.pathSegment}/${resourceId}`,
          {
            method: "DELETE",
          },
        )
      },
      onSuccess: (data, resourceId, context) => {
        console.info(
          "[personResourceHooks] delete success",
          JSON.stringify({
            resource: resourceKey,
            personId,
            resourceId,
          }),
        )
        queryClient.invalidateQueries({
          queryKey: queryKeys.listScope(personId),
          exact: false,
        })

        if (resourceId) {
          console.info(
            "[personResourceHooks] invalidating detail scope",
            JSON.stringify({
              resource: resourceKey,
              personId,
              resourceId,
            }),
          )
          queryClient.invalidateQueries({
            queryKey: queryKeys.detailScope(personId, resourceId),
            exact: false,
          })
        }

        queryClient.invalidateQueries({
          queryKey: personsQueryKeys.details(),
          exact: false,
        })
        queryClient.invalidateQueries({
          queryKey: personsQueryKeys.detail(personId),
          exact: false,
        })
        console.info(
          "[personResourceHooks] invalidated person detail scopes",
          JSON.stringify({
            personId,
            resource: resourceKey,
          }),
        )
        options?.onSuccess?.(data, resourceId, context)
      },
      ...options,
    })
  }

  return {
    useResourceList,
    useResource,
    useCreateResource,
    useUpdateResource,
    useDeleteResource,
    useDeleteResourceById,
  }
}

export const personResourceHooks = {
  addresses: createPersonResourceHooks<
    AddressDetails,
    AddressInput,
    Partial<AddressInput>
  >("addresses"),
  contacts: createPersonResourceHooks<
    ContactDetail,
    ContactInput,
    ContactUpdateInput
  >("contacts"),
  tags: createPersonResourceHooks<Tag, TagInput, TagInput>("tags"),
}
