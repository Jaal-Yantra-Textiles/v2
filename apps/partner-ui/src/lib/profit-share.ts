import type {
  PartnerProfitShare,
  PartnerProfitShareSale,
  ReportPartnerSalePayload,
} from "../hooks/api/partner-production-runs"

/**
 * #2401 — the pure parts of the partner's profit-share sheet, kept out of the
 * component so they can be tested without rendering.
 *
 * 🔑 `null` is not `0`. A run with no agreement comes back with
 * `percent: null` / `owed: null`; the button must not appear at all, rather
 * than appear and say ₹0 owed.
 */
export const hasProfitShareDeal = (
  profitShare: PartnerProfitShare | null | undefined
): boolean =>
  typeof profitShare?.percent === "number" &&
  Number.isFinite(profitShare.percent) &&
  profitShare.summary?.owed !== null &&
  profitShare.summary?.owed !== undefined

/** Quantity and unit price can arrive as strings / bigNumbers. */
export const saleLineTotal = (
  sale: Pick<PartnerProfitShareSale, "quantity" | "unit_price">
): number => (Number(sale.quantity) || 0) * (Number(sale.unit_price) || 0)

const pad = (n: number) => String(n).padStart(2, "0")

/** Today's date in the viewer's own timezone, as `YYYY-MM-DD` (date input value). */
export const localDateInputValue = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

/** `2026-10-13T12:00:00+05:30` — the server's schema demands an offset. */
export const toIsoWithOffset = (d: Date): string => {
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? "+" : "-"
  const abs = Math.abs(offsetMin)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/**
 * The picked sale date as a datetime. Today keeps the current time (so the
 * sale is not stamped in the future); any other day is stamped at local noon,
 * which no timezone shift can push onto a neighbouring date.
 */
export const soldAtFromDateInput = (
  value: string,
  now: Date = new Date()
): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  if (value === localDateInputValue(now)) return toIsoWithOffset(now)
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
  if (Number.isNaN(d.getTime())) return null
  return toIsoWithOffset(d)
}

export type SaleFormValues = {
  quantity: string
  unitPrice: string
  soldOn: string
  note: string
}

export type SaleFormError = "quantity" | "unitPrice" | "soldOn"

/** Validates the "Report a sale" form and builds the POST body. */
export const buildSalePayload = (
  values: SaleFormValues,
  now: Date = new Date()
):
  | { ok: true; payload: ReportPartnerSalePayload }
  | { ok: false; error: SaleFormError } => {
  const quantity = Number(values.quantity)
  if (!values.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: "quantity" }
  }
  const unitPrice = Number(values.unitPrice)
  if (!values.unitPrice.trim() || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    return { ok: false, error: "unitPrice" }
  }
  const soldAt = soldAtFromDateInput(values.soldOn, now)
  if (!soldAt) return { ok: false, error: "soldOn" }

  const note = values.note.trim()
  return {
    ok: true,
    payload: {
      quantity,
      unit_price: unitPrice,
      sold_at: soldAt,
      ...(note ? { note } : {}),
    },
  }
}
