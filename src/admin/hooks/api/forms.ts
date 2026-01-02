import { FetchError } from "@medusajs/js-sdk"
import { PaginatedResponse } from "@medusajs/types"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

export type AdminForm = {
  id: string
  created_at: Date
  updated_at: Date
  deleted_at?: Date | null
  [key: string]: any
}

export type AdminFormResponse = {
  id: string
  created_at: Date
  updated_at: Date
  deleted_at?: Date | null
  [key: string]: any
}

export type AdminFormField = {
  id?: string
  name: string
  label: string
  type:
    | "text"
    | "email"
    | "textarea"
    | "number"
    | "select"
    | "checkbox"
    | "radio"
    | "date"
    | "phone"
    | "url"
  required?: boolean
  placeholder?: string | null
  help_text?: string | null
  options?: Record<string, any> | null
  validation?: Record<string, any> | null
  order?: number
  metadata?: Record<string, any> | null
}

export type AdminFormsQuery = {
  q?: string
  status?: "draft" | "published" | "archived"
  website_id?: string
  domain?: string
  offset?: number
  limit?: number
  [key: string]: any
}

export type AdminFormResponsesQuery = {
  q?: string
  status?: "new" | "read" | "archived"
  email?: string
  offset?: number
  limit?: number
  [key: string]: any
}

export type CreateAdminFormPayload = {
  website_id?: string | null
  domain?: string | null
  handle: string
  title: string
  description?: string | null
  status?: "draft" | "published" | "archived"
  submit_label?: string | null
  success_message?: string | null
  settings?: Record<string, any> | null
  metadata?: Record<string, any> | null
  fields?: Array<Record<string, any>>
}

export type UpdateAdminFormPayload = Partial<CreateAdminFormPayload>

export type SetAdminFormFieldsPayload = {
  fields: AdminFormField[]
}

export interface AdminFormResponsePayload {
  form: AdminForm
}

export interface AdminFormsResponsePayload {
  forms: AdminForm[]
  count: number
  offset: number
  limit: number
}

export interface AdminFormResponsesResponsePayload {
  responses: AdminFormResponse[]
  count: number
  offset: number
  limit: number
}

export interface AdminFormResponseDetailResponsePayload {
  response: AdminFormResponse
}

const FORMS_QUERY_KEY = "forms" as const
export const formsQueryKeys = queryKeysFactory(FORMS_QUERY_KEY)

const FORM_RESPONSES_QUERY_KEY = "form_responses" as const
export const formResponsesQueryKeys = queryKeysFactory(FORM_RESPONSES_QUERY_KEY)

export const useForm = (
  formId: string,
  options?: Omit<
    UseQueryOptions<AdminFormResponsePayload, FetchError, AdminFormResponsePayload, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: formsQueryKeys.detail(formId),
    queryFn: async () =>
      sdk.client.fetch<AdminFormResponsePayload>(`/admin/forms/${formId}`, {
        method: "GET",
      }),
    ...options,
  })

  return { ...data, ...rest }
}

export const useFormResponse = (
  formId: string,
  responseId: string,
  options?: Omit<
    UseQueryOptions<
      AdminFormResponseDetailResponsePayload,
      FetchError,
      AdminFormResponseDetailResponsePayload,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: formResponsesQueryKeys.detail(responseId, { formId }),
    queryFn: async () =>
      sdk.client.fetch<AdminFormResponseDetailResponsePayload>(
        `/admin/forms/${formId}/responses/${responseId}`,
        {
          method: "GET",
        }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

export const useForms = (
  query?: AdminFormsQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminFormsResponsePayload>,
      FetchError,
      PaginatedResponse<AdminFormsResponsePayload>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: formsQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminFormsResponsePayload>>(`/admin/forms`, {
        method: "GET",
        query,
      }),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateForm = (
  options?: UseMutationOptions<AdminFormResponsePayload, FetchError, CreateAdminFormPayload>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<AdminFormResponsePayload>(`/admin/forms`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateForm = (
  formId: string,
  options?: UseMutationOptions<AdminFormResponsePayload, FetchError, UpdateAdminFormPayload>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<AdminFormResponsePayload>(`/admin/forms/${formId}`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.detail(formId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useSetFormFields = (
  formId: string,
  options?: UseMutationOptions<AdminFormResponsePayload, FetchError, SetAdminFormFieldsPayload>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<AdminFormResponsePayload>(`/admin/forms/${formId}/fields`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.detail(formId) })
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteForm = (
  formId: string,
  options?: UseMutationOptions<any, FetchError, void>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<any>(`/admin/forms/${formId}`, {
        method: "DELETE",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.detail(formId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useFormResponses = (
  formId: string,
  query?: AdminFormResponsesQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminFormResponsesResponsePayload>,
      FetchError,
      PaginatedResponse<AdminFormResponsesResponsePayload>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: formResponsesQueryKeys.list({ ...(query || {}), formId }),
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminFormResponsesResponsePayload>>(
        `/admin/forms/${formId}/responses`,
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  })

  return { ...data, ...rest }
}
