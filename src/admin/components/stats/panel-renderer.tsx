import { Text, Heading, Badge } from "@medusajs/ui"
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
  const value = raw ? (raw as any)[field] ?? raw.value : undefined
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

function ListPanel({
  result,
  display,
}: {
  result?: PanelResolveResult
  display?: Record<string, any>
}) {
  const raw = result?.data
  const items: any[] = raw?.groups ?? raw?.records ?? []
  const labelField = display?.labelField ?? "key"
  const valueField = display?.valueField ?? "value"

  if (!items.length) {
    return (
      <div className="p-4">
        <Text size="small" className="text-ui-fg-muted">
          No results
        </Text>
      </div>
    )
  }

  return (
    <div className="divide-y">
      {items.slice(0, display?.limit ?? 20).map((item, idx) => {
        const label = item?.keys?.[labelField] ?? item?.[labelField] ?? item?.key
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
  const rows: any[] = raw?.groups ?? raw?.records ?? []
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
    return (
      <div className="p-4">
        <Text size="small" className="text-ui-fg-muted">
          Loading…
        </Text>
      </div>
    )
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
