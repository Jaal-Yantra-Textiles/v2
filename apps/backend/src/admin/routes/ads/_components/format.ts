// Shared formatters used across the unified ads tabs. Currency, integer,
// and rate formatting all live here so the five DataTables don't drift
// apart on display rules (especially the micros→units conversion, which
// is easy to get wrong by 1e6 in one place and not another).

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return new Intl.NumberFormat("en-US").format(value)
}

export function formatPercent(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined) return "—"
  return `${value.toFixed(decimals)}%`
}

export function formatMicros(
  micros: number | null | undefined,
  currency: string | null | undefined = "USD"
): string {
  if (micros === null || micros === undefined || micros === 0) return "—"
  const value = micros / 1_000_000
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "USD").toUpperCase(),
      minimumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency || "USD"} ${value.toFixed(2)}`
  }
}

export function statusToTone(
  status: string | null | undefined
): "green" | "orange" | "red" | "grey" {
  const s = (status || "").toUpperCase()
  if (s === "ENABLED" || s === "ACTIVE" || s === "SYNCED") return "green"
  if (s === "PAUSED" || s === "PENDING" || s === "SYNCING") return "orange"
  if (s === "REMOVED" || s === "DELETED" || s === "ERROR") return "red"
  return "grey"
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return "—"
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return value
  }
}
