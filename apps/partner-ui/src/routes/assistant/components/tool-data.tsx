/**
 * Rich renderer for a partner tool result's `data` payload (#338 item 2 polish).
 *
 * Read tools (list_orders, list_products, …) return the raw partner-route
 * response — e.g. `{ orders: [...], count }`. Previously the chat threw all of
 * this away and showed only a "Ran: list orders" status line. This component
 * surfaces the data the partner actually asked for:
 *   - an array of records → a compact Medusa Table with human-picked columns;
 *   - a single record     → a key/value grid;
 *   - anything else        → collapsed raw JSON.
 * The raw JSON stays available under a disclosure for power users.
 */
import { useMemo } from "react"
import { Table, Text, Badge } from "@medusajs/ui"

/** Column keys we surface first, in priority order, when present on a row. */
const PREFERRED_COLUMNS = [
  "display_id",
  "title",
  "name",
  "handle",
  "email",
  "status",
  "fulfillment_status",
  "payment_status",
  "quantity",
  "sku",
  "total",
  "amount",
  "currency_code",
  "created_at",
]

const HIDDEN_KEYS = new Set(["id", "metadata", "raw_amount", "raw_total"])
const STATUS_KEYS = new Set([
  "status",
  "fulfillment_status",
  "payment_status",
  "state",
])
const DATE_KEYS = /(_at|_date)$/

const STATUS_COLOR: Record<string, "green" | "orange" | "red" | "grey" | "blue"> = {
  completed: "green",
  active: "green",
  published: "green",
  captured: "green",
  fulfilled: "green",
  paid: "green",
  pending: "orange",
  requires_action: "orange",
  draft: "grey",
  canceled: "red",
  cancelled: "red",
  failed: "red",
  rejected: "red",
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

/** Find the array a list tool actually returned (top-level or one level in). */
function findRows(data: unknown): { rows: Record<string, unknown>[]; count?: number } | null {
  if (Array.isArray(data)) {
    return data.every(isRecord) ? { rows: data as Record<string, unknown>[] } : null
  }
  if (isRecord(data)) {
    const count = typeof data.count === "number" ? data.count : undefined
    for (const value of Object.values(data)) {
      if (Array.isArray(value) && value.length && value.every(isRecord)) {
        return { rows: value as Record<string, unknown>[], count }
      }
    }
  }
  return null
}

/** Pick a small, meaningful column set shared across the rows. */
function pickColumns(rows: Record<string, unknown>[]): string[] {
  const present = new Set<string>()
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      const v = r[k]
      // Only scalar-ish columns; skip nested objects/arrays and noise.
      if (HIDDEN_KEYS.has(k)) continue
      if (v !== null && typeof v === "object") continue
      present.add(k)
    }
  }
  const ordered = PREFERRED_COLUMNS.filter((k) => present.has(k))
  if (ordered.length >= 3) return ordered.slice(0, 6)
  // Fill from remaining scalar keys until we have a usable table.
  for (const k of present) {
    if (!ordered.includes(k)) ordered.push(k)
    if (ordered.length >= 6) break
  }
  return ordered
}

function formatValue(key: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ui-fg-muted">—</span>
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No"
  }
  if (STATUS_KEYS.has(key) && typeof value === "string") {
    const color = STATUS_COLOR[value.toLowerCase()] ?? "grey"
    return (
      <Badge size="2xsmall" color={color} className="capitalize">
        {value.replace(/_/g, " ")}
      </Badge>
    )
  }
  if (DATE_KEYS.test(key) && typeof value === "string") {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    }
  }
  if (typeof value === "number") {
    return value.toLocaleString()
  }
  const str = String(value)
  return str.length > 48 ? `${str.slice(0, 45)}…` : str
}

const MAX_ROWS = 12
const HEADER_LABEL = (k: string) =>
  k.replace(/_/g, " ").replace(/\bid\b/i, "ID")

export function ToolData({ data }: { data: unknown }) {
  const table = useMemo(() => findRows(data), [data])

  // ---- Tabular: a list of records ----------------------------------------
  if (table && table.rows.length) {
    const { rows, count } = table
    const columns = pickColumns(rows)
    const shown = rows.slice(0, MAX_ROWS)
    const total = count ?? rows.length

    if (columns.length) {
      return (
        <div className="space-y-1.5">
          <div className="overflow-x-auto rounded-lg border border-ui-border-base">
            <Table className="min-w-full">
              <Table.Header>
                <Table.Row>
                  {columns.map((c) => (
                    <Table.HeaderCell key={c} className="whitespace-nowrap capitalize">
                      {HEADER_LABEL(c)}
                    </Table.HeaderCell>
                  ))}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {shown.map((row, i) => (
                  <Table.Row key={(row.id as string) || i}>
                    {columns.map((c) => (
                      <Table.Cell key={c}>
                        <div className="text-sm text-ui-fg-base whitespace-nowrap">
                          {formatValue(c, row[c])}
                        </div>
                      </Table.Cell>
                    ))}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
          <Text size="xsmall" className="text-ui-fg-muted">
            {total === 1 ? "1 result" : `${total.toLocaleString()} results`}
            {rows.length > MAX_ROWS ? ` · showing first ${MAX_ROWS}` : ""}
          </Text>
          <RawJsonDisclosure data={data} />
        </div>
      )
    }
  }

  // ---- Single record: key/value grid -------------------------------------
  if (isRecord(data)) {
    const entries = Object.entries(data).filter(
      ([k, v]) => !HIDDEN_KEYS.has(k) && (v === null || typeof v !== "object")
    )
    if (entries.length) {
      return (
        <div className="space-y-1.5">
          <div className="rounded-lg border border-ui-border-base divide-y divide-ui-border-base">
            {entries.slice(0, 14).map(([k, v]) => (
              <div key={k} className="flex gap-x-3 px-3 py-1.5">
                <Text
                  size="xsmall"
                  className="w-32 shrink-0 capitalize text-ui-fg-muted"
                >
                  {HEADER_LABEL(k)}
                </Text>
                <div className="text-sm text-ui-fg-base break-words min-w-0">
                  {formatValue(k, v)}
                </div>
              </div>
            ))}
          </div>
          <RawJsonDisclosure data={data} />
        </div>
      )
    }
  }

  // ---- Fallback: raw JSON only -------------------------------------------
  return <RawJsonDisclosure data={data} defaultLabel="View data" />
}

function RawJsonDisclosure({
  data,
  defaultLabel = "Raw data",
}: {
  data: unknown
  defaultLabel?: string
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs text-ui-fg-muted hover:text-ui-fg-subtle transition-colors select-none">
        <span className="group-open:hidden">▶ {defaultLabel}</span>
        <span className="hidden group-open:inline">▼ {defaultLabel}</span>
      </summary>
      <pre className="mt-1.5 max-h-64 overflow-auto rounded-lg bg-ui-bg-subtle p-2.5 font-mono text-[11px] leading-relaxed text-ui-fg-subtle">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  )
}
