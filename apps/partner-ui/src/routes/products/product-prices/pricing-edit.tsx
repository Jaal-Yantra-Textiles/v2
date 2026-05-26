import { zodResolver } from "@hookform/resolvers/zod"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@medusajs/ui"
import { useMemo } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z as zod } from "@medusajs/framework/zod"

import { FxPriceMetadata } from "../../../components/common/fx-auto-badge/fx-auto-badge"
import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import { KeyboundForm } from "../../../components/utilities/keybound-form"
import { useUpdateProductVariantsBatch } from "../../../hooks/api/products"
import { useRegions } from "../../../hooks/api/regions"
import { castNumber } from "../../../lib/cast-number"
import {
  FxAutoMetadataMap,
  VariantPricingForm,
} from "../common/variant-pricing-form"

export const UpdateVariantPricesSchema = zod.object({
  variants: zod.array(
    zod.object({
      prices: zod
        .record(zod.string(), zod.string().or(zod.number()).optional())
        .optional(),
    })
  ),
})

export type UpdateVariantPricesSchemaType = zod.infer<
  typeof UpdateVariantPricesSchema
>

export const PricingEdit = ({
  product,
  variantId,
}: {
  product: HttpTypes.AdminProduct
  variantId?: string
}) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const { mutateAsync, isPending } = useUpdateProductVariantsBatch(product.id)

  const { regions } = useRegions({ limit: 9999 })
  const regionsCurrencyMap = useMemo(() => {
    if (!regions?.length) {
      return {}
    }

    return regions.reduce((acc, reg) => {
      acc[reg.id] = reg.currency_code
      return acc
    }, {})
  }, [regions])

  const variants = variantId
    ? product.variants?.filter((v) => v.id === variantId)
    : product.variants

  // Build variantIndex -> currency|region_id -> FxPriceMetadata so the
  // pricing grid can render the FX badge on auto-converted cells.
  // The discriminator is the presence of a linked `fx_price_meta` row
  // on a price — see apps/backend/src/links/price-fx-meta.ts. The
  // partner-side products GET route walks variants.price_set.prices
  // and re-attaches `fx_price_meta` onto the flattened variant.prices.
  const fxAutoMetadata = useMemo<FxAutoMetadataMap | undefined>(() => {
    if (!variants?.length) return undefined
    const result: FxAutoMetadataMap = {}
    variants.forEach((variant: any, idx: number) => {
      const byKey: Record<string, FxPriceMetadata> = {}
      ;(variant.prices ?? []).forEach((price: any) => {
        const meta = price?.fx_price_meta as FxPriceMetadata | undefined
        if (!meta) return
        const key = price.rules?.region_id ?? price.currency_code
        if (!key) return
        byKey[key] = meta
      })
      if (Object.keys(byKey).length) result[idx] = byKey
    })
    return Object.keys(result).length ? result : undefined
  }, [variants])

  const form = useForm<UpdateVariantPricesSchemaType>({
    defaultValues: {
      variants: variants?.map((variant: any) => ({
        title: variant.title,
        prices: (variant.prices ?? []).reduce((acc: any, price: any) => {
          if (price.rules?.region_id) {
            acc[price.rules.region_id] = price.amount
          } else if (price.currency_code) {
            acc[price.currency_code] = price.amount
          }
          return acc
        }, {}),
      })) as any,
    },

    resolver: zodResolver(UpdateVariantPricesSchema, {}),
  })

  const handleSubmit = form.handleSubmit(async (values) => {
    const reqData = values.variants.map((variant, ind) => ({
      id: variants[ind].id,
      prices: Object.entries(variant.prices || {})
        .filter(
          ([_, value]) => value !== "" && typeof value !== "undefined" // deleted cells
        )
        .map(([currencyCodeOrRegionId, value]: any) => {
          const regionId = currencyCodeOrRegionId.startsWith("reg_")
            ? currencyCodeOrRegionId
            : undefined
          const currencyCode = currencyCodeOrRegionId.startsWith("reg_")
            ? regionsCurrencyMap[regionId]
            : currencyCodeOrRegionId

          let existingId = undefined

          if (regionId) {
            existingId = variants?.[ind]?.prices?.find(
              (p) => p.rules["region_id"] === regionId
            )?.id
          } else {
            existingId = variants?.[ind]?.prices?.find(
              (p) =>
                p.currency_code === currencyCode &&
                Object.keys(p.rules ?? {}).length === 0
            )?.id
          }

          const amount = castNumber(value)

          return {
            id: existingId,
            currency_code: currencyCode,
            amount,
            ...(regionId ? { rules: { region_id: regionId } } : {}),
          }
        }),
    }))

    await mutateAsync(reqData, {
      onSuccess: () => {
        handleSuccess("..")
      },
    })
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex size-full flex-col">
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-col overflow-hidden">
          <VariantPricingForm form={form as any} fxAutoMetadata={fxAutoMetadata} />
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex w-full items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button variant="secondary" size="small">
                {t("actions.cancel")}
              </Button>
            </RouteFocusModal.Close>
            <Button
              type="submit"
              variant="primary"
              size="small"
              isLoading={isPending}
            >
              {t("actions.save")}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
