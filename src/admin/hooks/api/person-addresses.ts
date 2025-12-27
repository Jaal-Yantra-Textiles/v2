import { FetchError } from "@medusajs/js-sdk"
import { UseMutationOptions, useQueryClient } from "@tanstack/react-query"

import {
  PersonResourceItemApiResponse,
  personResourceHooks,
} from "./person-resource-hooks"
import { AddressDetails, AddressInput } from "./personandtype"
import { personsQueryKeys } from "./persons"
import { PERSON_RESOURCE_META } from "./person-resource-meta"

const addressHooks = personResourceHooks.addresses
const ADDRESS_ITEM_KEY = PERSON_RESOURCE_META.addresses.itemKey

type AddressListOptions = Parameters<
  typeof addressHooks.useResourceList
>[2]

export const usePersonAddresses = (
  personId: string,
  query?: Record<string, any>,
  options?: AddressListOptions,
) => {
  const result = addressHooks.useResourceList(personId, query, options)

  return {
    ...result,
    addresses: result.items as AddressDetails[],
    count: result.count ?? result.items.length,
  }
}

type AddressMutationResult = PersonResourceItemApiResponse<AddressDetails>

type CreateOptions = UseMutationOptions<
  AddressMutationResult,
  FetchError,
  AddressInput
>

type BaseUpdateOptions = UseMutationOptions<
  AddressMutationResult,
  FetchError,
  Partial<AddressInput>
>

type UpdateOptions = Omit<BaseUpdateOptions, "onSuccess" | "onSettled"> & {
  onSuccess?: (
    data: { address: AddressDetails },
    variables: Partial<AddressInput>,
    context: unknown,
  ) => void
  onSettled?: (
    data: { address: AddressDetails } | undefined,
    error: FetchError | null,
    variables: Partial<AddressInput>,
    context: unknown,
  ) => void
}

const toAddressResult = (
  data?: PersonResourceItemApiResponse<AddressDetails>,
) => {
  if (!data) {
    return undefined
  }

  const address =
    (data[ADDRESS_ITEM_KEY] as AddressDetails | undefined) ||
    (data as { address?: AddressDetails }).address

  if (!address) {
    return undefined
  }

  return { address }
}

export const useAddAddressToPerson = (
  personId: string,
  options?: CreateOptions,
) => {
  const queryClient = useQueryClient()
  const {
    onSuccess: userOnSuccess,
    onSettled: userOnSettled,
    ...restOptions
  } = options ?? {}

  return addressHooks.useCreateResource(personId, {
    ...restOptions,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      })
      const shaped = toAddressResult(data)
      if (shaped) {
        userOnSuccess?.(shaped, variables, context)
      }
    },
    onSettled: (data, error, variables, context) => {
      const shaped = data ? toAddressResult(data) : undefined
      userOnSettled?.(shaped, error, variables, context)
    },
  })
}

export const useUpdatePersonAddress = (
  personId: string,
  addressId: string,
  options?: UpdateOptions,
) => {
  const queryClient = useQueryClient()
  const {
    onSuccess: userOnSuccess,
    onSettled: userOnSettled,
    ...restOptions
  } = options ?? {}

  return addressHooks.useUpdateResource(personId, addressId, {
    ...restOptions,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: personsQueryKeys.detail(personId),
      })

      const shaped = toAddressResult(data)
      if (shaped) {
        userOnSuccess?.(shaped, variables, context)
      }
    },
    onSettled: (data, error, variables, context) => {
      const shaped = data ? toAddressResult(data) : undefined
      userOnSettled?.(shaped, error, variables, context)
    },
  })
}

export const useDeletePersonAddress = (
  personId: string,
  options?: UseMutationOptions<void, FetchError, string>,
) => {
  return addressHooks.useDeleteResourceById(personId, options)
}
