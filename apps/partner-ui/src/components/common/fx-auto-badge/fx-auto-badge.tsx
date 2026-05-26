import { Tooltip } from "@medusajs/ui"

export type FxPriceMetadata = {
  is_auto_converted?: boolean
  base_currency?: string
  base_amount?: number
  fx_rate?: number
  source_price_id?: string
}

const formatAmount = (amount?: number, code?: string) => {
  if (amount == null || !code) return ""
  const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 })
  return `${fmt.format(amount)} ${code.toUpperCase()}`
}

const formatRate = (rate?: number, base?: string, quote?: string) => {
  if (rate == null || !base || !quote) return ""
  const fmt = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })
  return `${fmt.format(rate)} ${quote.toUpperCase()}/${base.toUpperCase()}`
}

export const FxAutoBadge = ({
  meta,
  targetCurrency,
}: {
  meta: FxPriceMetadata
  targetCurrency: string
}) => {
  const baseDesc = formatAmount(meta.base_amount, meta.base_currency)
  const rateDesc = formatRate(meta.fx_rate, meta.base_currency, targetCurrency)
  const tooltipText =
    baseDesc && rateDesc
      ? `Auto-converted from ${baseDesc} at ${rateDesc}. Edit to override.`
      : "Auto-converted price. Edit to override."

  return (
    <Tooltip content={tooltipText} maxWidth={320}>
      <span
        aria-label="auto-converted"
        className="text-ui-fg-muted bg-ui-bg-subtle pointer-events-auto absolute right-1 top-1 select-none rounded px-1 text-[10px] leading-tight"
      >
        FX
      </span>
    </Tooltip>
  )
}
