import { Badge, Container, Heading, Skeleton, Text } from "@medusajs/ui"
import type { ReactNode } from "react"
import {
  InvestorPanel,
  useInvestorPanelData,
  useInvestorPanels,
  useMyProjections,
  type ProjectionPortfolio,
} from "../../hooks/api/projections"

const nf = new Intl.NumberFormat()
const money = (v?: number | null, ccy?: string | null) =>
  v == null ? "—" : `${ccy ? ccy + " " : ""}${nf.format(Math.round(Number(v)))}`
const num = (v?: number | null) => (v == null ? "—" : nf.format(Number(v)))
const pct = (v?: number | null) => (v == null ? "—" : `${nf.format(Number(v))}%`)

// ── Tiny inline sparkline (no chart dependency; matches OwnershipDonut's
//    hand-rolled SVG approach). ──────────────────────────────────────────
const Sparkline = ({
  points,
  height = 48,
  width = 220,
}: {
  points: number[]
  height?: number
  width?: number
}) => {
  if (!points.length) return null
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const span = max - min || 1
  const step = points.length > 1 ? width / (points.length - 1) : width
  const path = points
    .map((p, i) => {
      const x = i * step
      const y = height - ((p - min) / span) * height
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  const area = `${path} L${width},${height} L0,${height} Z`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={area} fill="rgba(59,130,246,0.12)" />
      <path d={path} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}

const Tile = ({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: string
}) => (
  <div className="rounded-lg border p-3">
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text weight="plus" className="mt-1">
      {value}
    </Text>
    {hint && (
      <Text size="xsmall" className="text-ui-fg-muted mt-0.5">
        {hint}
      </Text>
    )}
  </div>
)

// Renders a resolved panel by the shape its operation produced. Known shapes
// are formatted; anything else falls back to a raw value so a newly-authored
// panel still shows *something* rather than breaking the tab.
const PanelBody = ({ data, operationType }: { data: any; operationType: string }) => {
  if (data == null) return <Text className="text-ui-fg-muted">No data</Text>

  // gmv_projection → headline amount + inputs
  if (operationType === "gmv_projection") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label={`Projected GMV (${data.window_days ?? 90}d)`}
          value={money(data.amount, data.currency)}
          hint="run-rate"
        />
        <Tile label="Live brands" value={num(data.brands_live)} />
        <Tile label="Artisans" value={num(data.artisans)} />
        <Tile
          label="Per-brand / mo"
          value={money(data.formula?.per_brand_monthly, data.currency)}
        />
      </div>
    )
  }

  // ads_efficiency → spend / CAC / ROAS
  if (operationType === "ads_efficiency") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={`Spend (${data.window_days ?? 30}d)`} value={money(data.spend, data.currency)} />
        <Tile label="Conversions" value={num(data.conversions)} />
        <Tile label="CAC" value={money(data.cac, data.currency)} />
        <Tile label="ROAS" value={data.roas == null ? "—" : `${data.roas}×`} />
        {data.fx_incomplete && (
          <div className="col-span-2 sm:col-span-4">
            <Badge size="2xsmall" color="orange">
              FX incomplete — some spend not converted
            </Badge>
          </div>
        )}
      </div>
    )
  }

  // time_series → sparkline + latest
  if (Array.isArray(data.buckets)) {
    const points = data.buckets.map((b: any) => Number(b.value) || 0)
    const latest = points.length ? points[points.length - 1] : null
    return (
      <div className="flex items-end justify-between gap-4">
        <div>
          <Text weight="plus">{num(latest)}</Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            latest · {data.precision ?? "day"}
          </Text>
        </div>
        <Sparkline points={points} />
      </div>
    )
  }

  // aggregate_data → single value
  if (typeof data.value === "number" || data.value === null) {
    return <Text weight="plus">{num(data.value)}</Text>
  }

  // Fallback
  return (
    <Text size="small" className="text-ui-fg-muted">
      {JSON.stringify(data).slice(0, 120)}
    </Text>
  )
}

const PanelCard = ({ panel }: { panel: InvestorPanel }) => {
  const { panel: resolved, isPending } = useInvestorPanelData(panel.id)
  return (
    <Container className="p-0">
      <div className="px-6 py-4">
        <Heading level="h3">{panel.name}</Heading>
      </div>
      <div className="px-6 pb-5">
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : resolved?.error ? (
          <Text size="small" className="text-ui-fg-muted">
            {resolved.error}
          </Text>
        ) : (
          <PanelBody data={resolved?.data} operationType={panel.operation_type} />
        )}
      </div>
    </Container>
  )
}

const PortfolioSection = ({
  portfolio,
  positions,
}: {
  portfolio?: ProjectionPortfolio
  positions: ReturnType<typeof useMyProjections>["positions"]
}) => {
  const ccy = positions[0]?.currency_code
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Your position</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Implied value uses each cap table's post-money valuation.
        </Text>
      </div>
      <div className="grid grid-cols-2 gap-3 px-6 py-5 sm:grid-cols-4">
        <Tile label="Total invested" value={money(portfolio?.total_invested, ccy)} />
        <Tile label="Implied value" value={money(portfolio?.total_implied_value, ccy)} />
        <Tile
          label="Blended multiple"
          value={portfolio?.blended_multiple == null ? "—" : `${portfolio.blended_multiple}×`}
          hint="paper MOIC"
        />
        <Tile label="Cap tables" value={num(portfolio?.cap_tables)} />
      </div>
      {positions.length > 0 && (
        <div className="flex flex-col gap-y-2 px-6 py-5">
          {positions.map((p) => (
            <div
              key={p.cap_table_id}
              className="flex items-center justify-between rounded-lg border px-3 py-2"
            >
              <div>
                <Text weight="plus" size="small">
                  {p.cap_table_name}
                </Text>
                <Text size="xsmall" className="text-ui-fg-muted">
                  {num(p.my_shares)} shares · {pct(p.ownership_pct)}
                </Text>
              </div>
              <div className="text-right">
                <Text weight="plus" size="small">
                  {money(p.implied_value, p.currency_code)}
                </Text>
                <Text size="xsmall" className="text-ui-fg-muted">
                  {p.multiple == null ? "—" : `${p.multiple}×`} on {money(p.my_invested, p.currency_code)}
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}
    </Container>
  )
}

export const Component = () => {
  const { panels, isPending: panelsPending } = useInvestorPanels()
  const { positions, portfolio, isPending: posPending } = useMyProjections()

  return (
    <div className="flex w-full flex-col gap-y-4 px-4 py-6 md:px-6">
      <div>
        <Heading level="h1">Projections</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Growth, marketing efficiency and your projected position.
        </Text>
      </div>

      {posPending ? (
        <Container className="p-6">
          <Skeleton className="h-32 w-full" />
        </Container>
      ) : (
        <PortfolioSection portfolio={portfolio} positions={positions} />
      )}

      {panelsPending ? (
        <Container className="p-6">
          <Skeleton className="h-24 w-full" />
        </Container>
      ) : panels.length === 0 ? (
        <Container className="p-6">
          <Text size="small" className="text-ui-fg-subtle">
            Growth and marketing metrics will appear here once published.
          </Text>
        </Container>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {panels.map((p) => (
            <PanelCard key={p.id} panel={p} />
          ))}
        </div>
      )}
    </div>
  )
}
