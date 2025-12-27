import { FetchError } from "@medusajs/js-sdk"
import { UseMutationOptions, useQueryClient } from "@tanstack/react-query"

import {
  PersonResourceItemApiResponse,
  personResourceHooks,
} from "./person-resource-hooks"
import {
  ContactDetail,
  ContactInput,
  ContactUpdateInput,
} from "./personandtype"
import { personsQueryKeys } from "./persons"
import { PERSON_RESOURCE_META } from "./person-resource-meta"

const contactHooks = personResourceHooks.contacts
const CONTACT_ITEM_KEY = PERSON_RESOURCE_META.contacts.itemKey

type ContactListOptions = Parameters<
  typeof contactHooks.useResourceList
>[2]

export const usePersonContacts = (
  personId: string,
  query?: Record<string, any>,
  options?: ContactListOptions,
) => {
  const result = contactHooks.useResourceList(personId, query, options)

  return {
    ...result,
    contacts: result.items as ContactDetail[],
    count: result.count ?? result.items.length,
  }
}

type ContactMutationResult = PersonResourceItemApiResponse<ContactDetail>

const toContactResult = (
  data?: PersonResourceItemApiResponse<ContactDetail>,
) => {
  if (!data) {
    return undefined
  }

  const contact =
    (data[CONTACT_ITEM_KEY] as ContactDetail | undefined) ||
    (data as { contact?: ContactDetail }).contact

  if (!contact) {
    return undefined
  }

  return { contact }
}

export const useAddContactToPerson = (
  personId: string,
  options?: UseMutationOptions<
    ContactMutationResult,
    FetchError,
    ContactInput
  >,
) => {
  const queryClient = useQueryClient()

  return contactHooks.useCreateResource(personId, {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      })
      const shaped = toContactResult(data)
      if (shaped) {
        options?.onSuccess?.(shaped, variables, context)
      }
    },
    onSettled: (data, error, variables, context) => {
      const shaped = data ? toContactResult(data) : undefined
      options?.onSettled?.(shaped, error, variables, context)
    },
  })
}

type UpdateContactOptions = UseMutationOptions<
  ContactMutationResult,
  FetchError,
  ContactUpdateInput
>

export const useUpdatePersonContact = (
  personId: string,
  contactId: string,
  options?: UpdateContactOptions,
) => {
  const queryClient = useQueryClient()

  return contactHooks.useUpdateResource(personId, contactId, {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      })
      const shaped = toContactResult(data)
      if (shaped) {
        options?.onSuccess?.(shaped, variables, context)
      }
    },
    onSettled: (data, error, variables, context) => {
      const shaped = data ? toContactResult(data) : undefined
      options?.onSettled?.(shaped, error, variables, context)
    },
  })
}

export const useDeletePersonContact = (
  personId: string,
  options?: UseMutationOptions<void, FetchError, string>,
) => {
  return contactHooks.useDeleteResourceById(personId, options)
}
