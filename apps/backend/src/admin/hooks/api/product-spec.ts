import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../../lib/config"

/**
 * #1349 — admin-side production spec (the mirror of the partner hooks).
 *
 * Same module, same workflow, same weave catalog: these call the admin routes
 * added in #1346, which differ from the partner ones only in that an admin is
 * not scoped to one partner's products.
 */

/** Mirrors `WeaveParamDef` in the backend catalog — min/max/step drive the input. */
export type WeaveParamDef = {
  key: string
  label: string
  unit: string
  min: number
  max: number
  step: number
  default: number
}

export type WeavePreset = {
  value: string
  label: string
  detailLabel: string
  params?: Record<string, number>
  finishes?: string[]
  note?: string
}

export type WeaveTechnique = {
  slug: string
  label: string
  family: string
  description: string
  params: WeaveParamDef[]
  defaultFinishes: string[]
  presets: WeavePreset[]
}

export type ProductSpecColor = {
  id?: string
  name: string
  hex_code?: string | null
  usage_notes?: string | null
  order?: number
  available?: boolean
}

export type ProductSpecField = {
  id?: string
  key: string
  label?: string | null
  value?: string | null
  order?: number
}

export type ProductSpec = {
  id?: string
  product_id?: string
  weave_technique?: string | null
  weave_label?: string | null
  params?: Record<string, number> | null
  finishes?: string[] | null
  notes?: string | null
  accepting_custom_orders?: boolean | null
  custom_order_lead_time_days?: number | null
  colors?: ProductSpecColor[]
  fields?: ProductSpecField[]
} | null

/** The payload the upsert route accepts. `colors`/`fields` REPLACE when sent. */
export type ProductSpecPayload = Omit<
  NonNullable<ProductSpec>,
  "id" | "product_id"
>

export const productSpecKeys = {
  all: ["admin-product-spec"] as const,
  detail: (productId: string) =>
    [...productSpecKeys.all, "detail", productId] as const,
  catalog: () => [...productSpecKeys.all, "weave-catalog"] as const,
}

/**
 * The weaving-technique catalog behind the picker.
 *
 * Static for the life of a deploy — the ranges, defaults and presets come from
 * the same module the backend validates against — so it is cached hard rather
 * than refetched per product.
 */
export const useWeaveCatalog = () => {
  const { data, ...rest } = useQuery({
    queryKey: productSpecKeys.catalog(),
    queryFn: async () =>
      (await sdk.client.fetch("/admin/products/spec-catalog", {
        method: "GET",
      })) as { techniques: WeaveTechnique[]; families: string[] },
    staleTime: Infinity,
  })

  return {
    techniques: data?.techniques ?? [],
    families: data?.families ?? [],
    ...rest,
  }
}

/**
 * A product's saved spec. Loaded on mount, unconditionally — a display query
 * gated on modal state renders empty on every page refresh.
 */
export const useProductSpec = (productId: string) => {
  const { data, ...rest } = useQuery({
    queryKey: productSpecKeys.detail(productId),
    queryFn: async () =>
      (await sdk.client.fetch(`/admin/products/${productId}/spec`, {
        method: "GET",
      })) as { spec: ProductSpec },
    enabled: !!productId,
  })

  return { spec: data?.spec ?? null, ...rest }
}

export const useUpsertProductSpec = (productId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: ProductSpecPayload) =>
      (await sdk.client.fetch(`/admin/products/${productId}/spec`, {
        method: "POST",
        body: payload,
      })) as { spec: ProductSpec },
    onSuccess: () => {
      // The DISPLAY query, not just whatever the modal read — otherwise the
      // widget keeps rendering the pre-save spec until the page is reloaded.
      queryClient.invalidateQueries({
        queryKey: productSpecKeys.detail(productId),
      })
    },
  })
}
