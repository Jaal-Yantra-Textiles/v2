import { Text } from "@medusajs/ui"

export type DonutSegment = {
  label: string
  value: number
  highlight?: boolean
}

// Brand-neutral categorical palette that reads in both light and dark themes.
const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#ef4444",
  "#84cc16",
]

const polar = (cx: number, cy: number, r: number, angle: number) => {
  const a = (angle - 90) * (Math.PI / 180)
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

const arcPath = (
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number
) => {
  // Guard against a full 360° arc (SVG can't draw it as a single arc).
  const sweep = end - start
  const e = sweep >= 360 ? start + 359.999 : end
  const p1 = polar(cx, cy, rOuter, start)
  const p2 = polar(cx, cy, rOuter, e)
  const p3 = polar(cx, cy, rInner, e)
  const p4 = polar(cx, cy, rInner, start)
  const large = sweep > 180 ? 1 : 0
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ")
}

const fmt = (v: number) => new Intl.NumberFormat().format(Math.round(v))

/**
 * A dependency-free SVG donut for cap-table ownership. Renders even with no
 * segments (an empty ring + centre label), so the cap table shows a chart by
 * default before anyone has participated.
 */
export const OwnershipDonut = ({
  segments,
  centerLabel,
  centerValue,
  size = 176,
}: {
  segments: DonutSegment[]
  centerLabel?: string
  centerValue?: string
  size?: number
}) => {
  const cx = size / 2
  const cy = size / 2
  const rOuter = size / 2
  const rInner = size / 2 - 22

  const total = segments.reduce((s, seg) => s + (seg.value || 0), 0)
  const hasData = total > 0

  let cursor = 0
  const arcs = hasData
    ? segments.map((seg, i) => {
        const frac = (seg.value || 0) / total
        const start = cursor * 360
        cursor += frac
        const end = cursor * 360
        return {
          d: arcPath(cx, cy, rOuter, rInner, start, end),
          color: PALETTE[i % PALETTE.length],
          highlight: seg.highlight,
          label: seg.label,
          pct: frac * 100,
        }
      })
    : []

  return (
    <div className="flex flex-col items-center gap-y-4 sm:flex-row sm:gap-x-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {hasData ? (
            arcs.map((a, i) => (
              <path
                key={i}
                d={a.d}
                fill={a.color}
                stroke="var(--bg-base, #fff)"
                strokeWidth={a.highlight ? 2 : 1}
                opacity={a.highlight === false ? 0.65 : 1}
              />
            ))
          ) : (
            <circle
              cx={cx}
              cy={cy}
              r={(rOuter + rInner) / 2}
              fill="none"
              stroke="var(--border-base, #e5e7eb)"
              strokeWidth={rOuter - rInner}
              strokeDasharray="4 6"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Text size="small" className="text-ui-fg-subtle">
            {centerLabel ?? "Total"}
          </Text>
          <Text weight="plus" className="text-ui-fg-base">
            {centerValue ?? (hasData ? fmt(total) : "—")}
          </Text>
        </div>
      </div>

      <div className="flex w-full flex-col gap-y-1.5">
        {hasData ? (
          arcs.map((a, i) => (
            <div key={i} className="flex items-center justify-between gap-x-3">
              <div className="flex items-center gap-x-2 truncate">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: a.color }}
                />
                <Text
                  size="small"
                  className={a.highlight ? "text-ui-fg-base" : "text-ui-fg-subtle"}
                  weight={a.highlight ? "plus" : "regular"}
                >
                  {a.label}
                </Text>
              </div>
              <Text size="small" className="text-ui-fg-subtle shrink-0">
                {a.pct.toFixed(1)}%
              </Text>
            </div>
          ))
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            No allocations yet. Ownership will appear here once investors
            participate and are paid.
          </Text>
        )}
      </div>
    </div>
  )
}
