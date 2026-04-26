import { Text, Heading, Badge } from "@medusajs/ui"
import { Skeleton, HeadingSkeleton, TextSkeleton } from "../table/skeleton"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts"
import type { StatsPanel, PanelResolveResult } from "../../hooks/api/stats"

type PanelRendererProps = {
  panel: Pick<StatsPanel, "type" | "name" | "display">
  result?: PanelResolveResult
  isLoading?: boolean
  error?: string | null
}

function formatValue(
  value: unknown,
  display: Record<string, any> | undefined
): string {
  if (value === null || value === undefined) return "—"
  let out: string
  if (typeof value === "number") {
    const fractionDigits = display?.decimals ?? (Number.isInteger(value) ? 0 : 2)
    out = value.toLocaleString(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
  } else {
    out = String(value)
  }
  if (display?.prefix) out = `${display.prefix}${out}`
  if (display?.suffix) out = `${out}${display.suffix}`
  return out
}

function MetricPanel({
  result,
  display,
}: {
  result?: PanelResolveResult
  display?: Record<string, any>
}) {
  const raw = result?.data
  const field = display?.field ?? "value"
  const value = raw ? (raw as any)[field] ?? (raw as any).value : undefined

  // Misconfig guard: metric expects a scalar (read `raw.value` or an explicit
  // field override). A panel wired to `read_data`, a grouped `aggregate_data`,
  // or `time_series` lands here with no scalar — surface it.
  if (raw && value === undefined) {
    const shape = Array.isArray((raw as any).records)
      ? "records"
      : Array.isArray((raw as any).groups)
      ? "groups"
      : Array.isArray((raw as any).buckets)
      ? "buckets"
      : null
    if (shape) {
      return (
        <div className="p-4">
          <Text size="small" className="text-ui-fg-error">
            Metric panel got a {shape} list instead of a scalar. Use
            aggregate_data without groupBy, or set display.field to pick a
            field off the first record.
          </Text>
        </div>
      )
    }
  }

  return (
    <div className="flex flex-col gap-y-1 p-4">
      <Heading level="h1" className="text-4xl font-semibold">
        {formatValue(value, display)}
      </Heading>
      {display?.label && (
        <Text size="small" className="text-ui-fg-subtle">
          {display.label}
        </Text>
      )}
      {raw?.row_count !== undefined && (
        <Text size="xsmall" className="text-ui-fg-muted">
          {raw.row_count} rows scanned{raw.truncated ? " (truncated)" : ""}
        </Text>
      )}
    </div>
  )
}

const RECORD_LABEL_FALLBACK = ["name", "title", "label", "handle", "email", "id"]
const RECORD_VALUE_FALLBACK = ["status", "quantity", "amount", "count", "value"]

function pickField(item: Record<string, any>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (item[c] !== undefined && item[c] !== null) return c
  }
  return undefined
}

function ListPanel({
  result,
  display,
}: {
  result?: PanelResolveResult
  display?: Record<string, any>
}) {
  const raw = result?.data
  const items: any[] = raw?.groups ?? raw?.records ?? []

  // Scalar result from aggregate_data without groupBy — a common misconfig
  // (list panel paired with a count aggregate). Surface it instead of
  // silently rendering "No results".
  if (!items.length && raw && typeof raw === "object" && "value" in raw && !("groups" in raw)) {
    return (
      <div className="p-4">
        <Text size="small" className="text-ui-fg-error">
          This list panel is reading a scalar aggregate. Use groupBy on
          aggregate_data, or switch the operation to read_data.
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted mt-1">
          value: {formatValue((raw as any).value, display)}
        </Text>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="p-4">
        <Text size="small" className="text-ui-fg-muted">
          No results
        </Text>
      </div>
    )
  }

  const first = items[0] ?? {}
  const isGrouped = first?.keys !== undefined || first?.key !== undefined
  const labelField =
    display?.labelField ??
    (isGrouped ? "key" : pickField(first, RECORD_LABEL_FALLBACK) ?? "id")
  const valueField =
    display?.valueField ??
    (isGrouped ? "value" : pickField(first, RECORD_VALUE_FALLBACK) ?? "value")

  return (
    <div className="divide-y">
      {items.slice(0, display?.limit ?? 20).map((item, idx) => {
        const label =
          item?.keys?.[labelField] ?? item?.[labelField] ?? item?.key
        const value = item?.[valueField]
        return (
          <div key={idx} className="flex justify-between items-center px-4 py-2">
            <Text size="small" className="truncate">
              {label !== undefined && label !== null ? String(label) : "—"}
            </Text>
            <Badge size="xsmall">{formatValue(value, display)}</Badge>
          </div>
        )
      })}
    </div>
  )
}

function TablePanel({
  result,
  display,
}: {
  result?: PanelResolveResult
  display?: Record<string, any>
}) {
  const raw = result?.data
  const rows: any[] = raw?.groups ?? raw?.records ?? raw?.buckets ?? []

  // Misconfig guard: scalar aggregate can't render as rows.
  if (!rows.length && raw && typeof raw === "object" && "value" in raw && !("groups" in raw)) {
    return (
      <div className="p-4">
        <Text size="small" className="text-ui-fg-error">
          Table panel is reading a scalar aggregate. Use groupBy on
          aggregate_data, or switch the operation to read_data.
        </Text>
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="p-4">
        <Text size="small" className="text-ui-fg-muted">
          No results
        </Text>
      </div>
    )
  }
  const columns: string[] = display?.columns ?? Object.keys(rows[0])
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-ui-bg-subtle">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium text-ui-fg-subtle">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.slice(0, display?.limit ?? 50).map((row, idx) => (
            <tr key={idx}>
              {columns.map((c) => {
                const v = row?.keys?.[c] ?? row?.[c]
                return (
                  <td key={c} className="px-3 py-2 truncate max-w-[200px]">
                    {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "—")}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartPanel({
  kind,
  result,
  display,
}: {
  kind: "bar" | "line" | "area"
  result?: PanelResolveResult
  display?: Record<string, any>
}) {
  const raw = result?.data
  const buckets: any[] = raw?.buckets ?? raw?.groups ?? []

  // Misconfig guards: scalar aggregate or raw records can't be charted.
  if (!buckets.length && raw && typeof raw === "object") {
    if ("value" in raw && !("groups" in raw)) {
      return (
        <div className="p-4">
          <Text size="small" className="text-ui-fg-error">
            Chart panel is reading a scalar aggregate. Use time_series, or
            aggregate_data with groupBy.
          </Text>
        </div>
      )
    }
    if (Array.isArray((raw as any).records)) {
      return (
        <div className="p-4">
          <Text size="small" className="text-ui-fg-error">
            Chart panel got a records list from read_data. Use time_series
            for date-bucketed charts, or aggregate_data with groupBy.
          </Text>
        </div>
      )
    }
  }

  if (!buckets.length) {
    return (
      <div className="p-4">
        <Text size="small" className="text-ui-fg-muted">
          No data
        </Text>
      </div>
    )
  }

  const xKey = display?.xAxis ?? (buckets[0]?.date ? "date" : "key")
  const yKey = display?.yAxis ?? "value"

  // Pivot for grouped series (buckets have `series` field)
  let data: any[] = buckets
  let seriesNames: string[] = [yKey]
  if (buckets[0]?.series !== undefined) {
    const xMap = new Map<string, any>()
    const allSeries = new Set<string>()
    for (const b of buckets) {
      const x = b[xKey]
      if (!xMap.has(x)) xMap.set(x, { [xKey]: x })
      xMap.get(x)![b.series] = b[yKey]
      allSeries.add(b.series)
    }
    data = Array.from(xMap.values())
    seriesNames = Array.from(allSeries)
  }

  const colors = ["#6366f1", "#f97316", "#10b981", "#ef4444", "#eab308", "#06b6d4", "#8b5cf6"]

  return (
    <ResponsiveContainer width="100%" height={240}>
      {kind === "bar" ? (
        <BarChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey={xKey} fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          {seriesNames.length > 1 && <Legend />}
          {seriesNames.map((s, i) => (
            <Bar key={s} dataKey={s} fill={colors[i % colors.length]} />
          ))}
        </BarChart>
      ) : kind === "line" ? (
        <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey={xKey} fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          {seriesNames.length > 1 && <Legend />}
          {seriesNames.map((s, i) => (
            <Line
              key={s}
              type="monotone"
              dataKey={s}
              stroke={colors[i % colors.length]}
              dot={false}
            />
          ))}
        </LineChart>
      ) : (
        <AreaChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey={xKey} fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          {seriesNames.length > 1 && <Legend />}
          {seriesNames.map((s, i) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stroke={colors[i % colors.length]}
              fill={colors[i % colors.length]}
              fillOpacity={0.2}
            />
          ))}
        </AreaChart>
      )}
    </ResponsiveContainer>
  )
}

function PanelSkeleton({ type }: { type: StatsPanel["type"] }) {
  if (type === "metric") {
    return (
      <div className="flex flex-col gap-y-2 p-4">
        <HeadingSkeleton level="h1" characters={6} />
        <TextSkeleton size="small" characters={14} />
      </div>
    )
  }
  if (type === "list" || type === "table") {
    return (
      <div className="flex flex-col divide-y">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between items-center px-4 py-3">
            <TextSkeleton size="small" characters={18} />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    )
  }
  if (type === "label") {
    return (
      <div className="flex flex-col gap-y-2 p-4">
        <HeadingSkeleton level="h2" characters={12} />
        <TextSkeleton size="small" characters={24} />
      </div>
    )
  }
  return (
    <div className="flex items-end justify-between gap-2 px-4 py-6 h-[240px]">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton
          key={i}
          className="flex-1"
          style={{ height: `${30 + ((i * 37) % 70)}%` }}
        />
      ))}
    </div>
  )
}

function LabelPanel({
  panel,
  display,
}: {
  panel: Pick<StatsPanel, "name">
  display?: Record<string, any>
}) {
  return (
    <div className="p-4">
      <Heading level="h2" className="text-lg font-semibold">
        {display?.title ?? panel.name}
      </Heading>
      {display?.text && (
        <Text size="small" className="text-ui-fg-subtle mt-1 whitespace-pre-wrap">
          {display.text}
        </Text>
      )}
    </div>
  )
}

export function PanelRenderer({ panel, result, isLoading, error }: PanelRendererProps) {
  const display = (panel.display ?? {}) as Record<string, any>

  if (panel.type === "label") {
    return <LabelPanel panel={panel} display={display} />
  }

  if (isLoading) {
    return <PanelSkeleton type={panel.type} />
  }

  if (error || result?.error) {
    return (
      <div className="p-4">
        <Text size="small" className="text-ui-fg-error">
          {error || result?.error}
        </Text>
      </div>
    )
  }

  switch (panel.type) {
    case "metric":
      return <MetricPanel result={result} display={display} />
    case "list":
      return <ListPanel result={result} display={display} />
    case "table":
      return <TablePanel result={result} display={display} />
    case "bar":
    case "line":
    case "area":
      return <ChartPanel kind={panel.type} result={result} display={display} />
    default:
      return (
        <div className="p-4">
          <Text size="small" className="text-ui-fg-muted">
            Unknown panel type: {panel.type}
          </Text>
        </div>
      )
  }
}
