import { FetchError } from "@medusajs/js-sdk"
import { UseMutationOptions, useQueryClient } from "@tanstack/react-query"

import {
  PersonResourceItemApiResponse,
  personResourceHooks,
} from "./person-resource-hooks"
import { Tag } from "./personandtype"
import { PERSON_RESOURCE_META } from "./person-resource-meta"
import { personsQueryKeys } from "./persons"

export interface TagInput {
  name: string[]
}

const tagHooks = personResourceHooks.tags
const TAG_ITEM_KEY = PERSON_RESOURCE_META.tags.itemKey

type TagListOptions = Parameters<typeof tagHooks.useResourceList>[2]

export const usePersonTags = (
  personId: string,
  query?: Record<string, any>,
  options?: TagListOptions,
) => {
  const result = tagHooks.useResourceList(personId, query, options)

  return {
    ...result,
    tags: result.items as Tag[],
    count: result.count ?? result.items.length,
  }
}

type TagMutationResult = PersonResourceItemApiResponse<Tag>

const toTagResult = (data?: TagMutationResult) => {
  if (!data) {
    return undefined
  }

  const tag = (data[TAG_ITEM_KEY] as Tag | undefined) || data.tag

  if (!tag) {
    return undefined
  }

  return { tag }
}

export const useAddTagsToPerson = (
  personId: string,
  options?: UseMutationOptions<TagMutationResult, FetchError, TagInput>,
) => {
  const queryClient = useQueryClient()
  const { onSuccess, onSettled, ...restOptions } = options ?? {}

  return tagHooks.useCreateResource(personId, {
    ...restOptions,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      })
      const shaped = toTagResult(data)
      if (shaped) {
        onSuccess?.(shaped, variables, context)
      }
    },
    onSettled: (data, error, variables, context) => {
      const shaped = data ? toTagResult(data) : undefined
      onSettled?.(shaped, error, variables, context)
    },
  })
}

export const useUpdatePersonTags = (
  personId: string,
  tagId: string,
  options?: UseMutationOptions<TagMutationResult, FetchError, TagInput>,
) => {
  const queryClient = useQueryClient()
  const { onSuccess, onSettled, ...restOptions } = options ?? {}

  return tagHooks.useUpdateResource(personId, tagId, {
    ...restOptions,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      })
      const shaped = toTagResult(data)
      if (shaped) {
        onSuccess?.(shaped, variables, context)
      }
    },
    onSettled: (data, error, variables, context) => {
      const shaped = data ? toTagResult(data) : undefined
      onSettled?.(shaped, error, variables, context)
    },
  })
}

export const useDeletePersonTag = (
  personId: string,
  options?: UseMutationOptions<void, FetchError, string>,
) => {
  return tagHooks.useDeleteResourceById(personId, options)
}
