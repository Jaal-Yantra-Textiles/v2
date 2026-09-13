/** Format a cost value with currency code */
export function formatCost(value: number | null | undefined, currency?: string | null): string {
  if (value == null) return "-"
  const code = (currency || "").toUpperCase()
  return code ? `${code} ${value}` : String(value)
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "-"
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatFullDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ""
  return new Date(dateStr).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function durationBetween(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return ""
  const diffMs = new Date(to).getTime() - new Date(from).getTime()
  if (diffMs < 0) return ""
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m`
  const days = Math.floor(hrs / 24)
  return `${days}d ${hrs % 24}h`
}

export function getTargetDateStatus(targetDate: string | null | undefined): {
  label: string
  color: "red" | "orange" | "grey"
} | null {
  if (!targetDate) return null
  const target = new Date(targetDate)
  const now = new Date()
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const formatted = target.toLocaleDateString("en-US", { month: "short", day: "numeric" })

  if (diffDays < 0) return { label: `Overdue (${formatted})`, color: "red" }
  if (diffDays <= 2) return { label: `Due ${formatted}`, color: "orange" }
  return { label: `Due ${formatted}`, color: "grey" }
}

/** Map run status to StatusBadge color */
export const runStatusColor = (status: string): "green" | "orange" | "red" | "blue" | "grey" => {
  switch (status) {
    case "completed": return "green"
    case "in_progress": return "orange"
    case "sent_to_partner": return "blue"
    case "cancelled": return "red"
    default: return "grey"
  }
}
