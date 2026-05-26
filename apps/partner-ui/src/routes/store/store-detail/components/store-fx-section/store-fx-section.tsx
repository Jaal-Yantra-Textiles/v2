import { AdminStore } from "@medusajs/types"
import { Container, Heading, Switch, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { useUpdateStore } from "../../../../../hooks/api/store"

// Reads the store's `metadata.fx_auto_convert` flag (default true) and
// lets the partner flip it. When false, the FX fanout subscriber
// short-circuits for this store's variant prices — so partner-set
// prices no longer auto-replicate across the store's other supported
// currencies. Useful when the partner wants to hand-curate every
// price per currency.
//
// Backend check lives in apps/backend/src/workflows/fx/fanout-prices.ts
// (the `if (store.metadata?.fx_auto_convert === false)` short-circuit).
type StoreFxSectionProps = {
  store: AdminStore
}

export const StoreFxSection = ({ store }: StoreFxSectionProps) => {
  const { t } = useTranslation()
  const metaFlag = (store?.metadata as Record<string, unknown> | undefined)?.[
    "fx_auto_convert"
  ]
  // Default ON when undefined — fanout has always been the default
  // behavior since PR G3 shipped.
  const initial = metaFlag !== false
  const [enabled, setEnabled] = useState(initial)
  const { mutateAsync, isPending } = useUpdateStore(store.id)

  const handleChange = async (next: boolean) => {
    const previous = enabled
    setEnabled(next)
    try {
      await mutateAsync({
        metadata: {
          ...(store.metadata ?? {}),
          fx_auto_convert: next,
        } as Record<string, unknown>,
      } as any)
      toast.success(
        next
          ? t(
              "store.fxAutoConvertEnabled",
              "Auto-conversion enabled. New base prices will fan out to other currencies."
            )
          : t(
              "store.fxAutoConvertDisabled",
              "Auto-conversion disabled. Partner manages each currency manually."
            )
      )
    } catch (err) {
      setEnabled(previous)
      const message = err instanceof Error ? err.message : String(err)
      toast.error(
        t(
          "store.fxAutoConvertError",
          "Could not update FX auto-conversion: {{message}}",
          { message }
        )
      )
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>
            {t("store.fxAutoConvertTitle", "Auto-convert prices across regions")}
          </Heading>
          <Text className="text-ui-fg-subtle" size="small">
            {t(
              "store.fxAutoConvertDescription",
              "When on, prices you set in your base currency are automatically converted to your other supported currencies using daily FX rates. Turn off to manage every currency manually."
            )}
          </Text>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleChange}
          disabled={isPending}
          aria-label="fx-auto-convert"
        />
      </div>
    </Container>
  )
}
