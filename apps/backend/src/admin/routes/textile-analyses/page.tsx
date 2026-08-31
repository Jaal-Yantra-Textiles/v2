import { useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Swatch } from "@medusajs/icons"
import {
  Badge,
  Container,
  Heading,
  Input,
  Select,
  Skeleton,
  Text,
} from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

/**
 * Fabrics and garments, browsable by what a vision model saw in them.
 *
 * ## Why this screen exists
 *
 * The analysis was collected 37 times and read zero times. It lived in
 * `MediaFile.metadata.textile_extraction` — a JSON blob `query.graph` cannot
 * filter into — so the question it exists to answer ("what else do we have like
 * this?") could not be asked, and nothing anywhere rendered it. Every one of
 * those files also had a good title inside the blob and an EMPTY
 * `MediaFile.title` beside it.
 *
 * Typed columns made the question askable. This is the screen that asks it.
 *
 * 🔑 Pictures, not rows of text. The thing being chosen is cloth; a table of
 * `cloth_type | pattern | weight` describes fabric to someone who needs to SEE
 * it. The filters are the typed columns, and each is indexed — which is the
 * whole argument for them being columns.
 */

type TextileAnalysis = {
  id: string
  source: string
  confidence?: number | null
  cloth_type?: string | null
  category?: string | null
  pattern?: string | null
  fabric_weight?: string | null
  weave_or_knit?: string | null
  primary_color?: string | null
  title?: string | null
  description?: string | null
  colors?: string[] | null
  season?: string[] | null
  occasion?: string[] | null
  analyzed_at?: string | null
  media?: {
    id: string
    file_name: string
    file_path: string
    title?: string | null
  } | null
}

type ListResponse = {
  textile_analyses: TextileAnalysis[]
  count: number
}

/** "" means "no filter", and must never reach the query string as `field=`. */
const ANY = ""

const FILTERS = [
  {
    key: "cloth_type" as const,
    label: "Garment",
    options: ["top", "saree", "trousers", "shirt", "scarf", "shawl", "robe", "fabric"],
  },
  {
    key: "pattern" as const,
    label: "Pattern",
    options: ["solid", "floral", "stripe", "check", "block-print", "geometric"],
  },
  {
    key: "fabric_weight" as const,
    label: "Weight",
    options: ["light-weight", "medium-weight", "heavy-weight"],
  },
  {
    key: "weave_or_knit" as const,
    label: "Construction",
    options: ["woven", "knit"],
  },
]

const TextileAnalysesPage = () => {
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [search, setSearch] = useState("")

  /**
   * ⚠️ Blank values are DROPPED rather than sent. A `cloth_type=` in the query
   * string filters for the empty string and returns nothing — a filter that has
   * been opened and cleared would silently empty the catalogue, which reads as
   * "we hold no fabric like that" rather than "you asked for nothing".
   */
  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) {
      if (v && v !== ANY) params.set(k, v)
    }
    if (search.trim()) params.set("q", search.trim())
    params.set("limit", "60")
    return params.toString()
  }, [filters, search])

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["textile-analyses", queryString],
    queryFn: () =>
      sdk.client.fetch<ListResponse>(`/admin/textile-analyses?${queryString}`),
  })

  const rows = data?.textile_analyses ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-4 px-6 py-4">
        <div>
          <Heading level="h2">Textile library</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            What a vision model saw in every fabric and garment photo we hold —
            filterable by garment, pattern, weight and construction.
          </Text>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-col gap-1">
            <Text size="xsmall" weight="plus">
              Search
            </Text>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="indigo, poppy, handwoven…"
              data-testid="textile-search"
            />
          </div>

          {FILTERS.map((f) => (
            <div key={f.key} className="flex min-w-44 flex-col gap-1">
              <Text size="xsmall" weight="plus">
                {f.label}
              </Text>
              <Select
                value={filters[f.key] ?? ANY}
                onValueChange={(v) =>
                  setFilters((prev) => ({ ...prev, [f.key]: v }))
                }
              >
                <Select.Trigger data-testid={`textile-filter-${f.key}`}>
                  <Select.Value placeholder="Any" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value={ANY}>Any</Select.Item>
                  {f.options.map((o) => (
                    <Select.Item key={o} value={o}>
                      {o.replace(/-/g, " ")}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 py-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-10">
            <Text className="text-ui-fg-subtle">
              Nothing matches those filters.
            </Text>
            {/*
              🔑 Says WHY it might be empty. Until the backfill runs, this table
              holds only what has been analysed since the module shipped — an
              empty grid otherwise reads as "we own no such fabric".
            */}
            <Text size="xsmall" className="text-ui-fg-muted">
              Photos analysed before this library existed are migrated by the
              `backfill-textile-analysis` maintenance job.
            </Text>
          </div>
        ) : (
          <>
            <Text size="xsmall" className="text-ui-fg-muted mb-3">
              {data?.count ?? rows.length} match
              {(data?.count ?? rows.length) === 1 ? "" : "es"}
            </Text>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="shadow-elevation-card-rest bg-ui-bg-component flex flex-col gap-2 rounded-lg p-2"
                  data-testid="textile-card"
                >
                  {row.media?.file_path ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={row.media.file_path}
                      alt={row.title ?? row.media.file_name}
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  ) : (
                    <div className="bg-ui-bg-base-pressed flex aspect-square w-full items-center justify-center rounded-md">
                      <Text size="xsmall" className="text-ui-fg-muted">
                        no image
                      </Text>
                    </div>
                  )}

                  <Text size="xsmall" weight="plus" className="line-clamp-2">
                    {row.title ?? row.media?.file_name ?? "Untitled"}
                  </Text>

                  <div className="flex flex-wrap gap-1">
                    {row.cloth_type && (
                      <Badge size="2xsmall" color="blue">
                        {row.cloth_type}
                      </Badge>
                    )}
                    {row.pattern && (
                      <Badge size="2xsmall" color="purple">
                        {row.pattern}
                      </Badge>
                    )}
                    {row.fabric_weight && (
                      <Badge size="2xsmall" color="grey">
                        {row.fabric_weight.replace(/-/g, " ")}
                      </Badge>
                    )}
                    {/*
                      Where this reading came from. Our own extraction over
                      stock we hold and a stranger's storefront upload deserve
                      different trust, and before the module the only thing
                      telling them apart was which metadata key someone wrote.
                    */}
                    {row.source === "storefront_reference" && (
                      <Badge size="2xsmall" color="orange">
                        customer photo
                      </Badge>
                    )}
                  </div>

                  {/*
                    ⚠️ Rendered only when the extractor actually gave a number.
                    `confidence` is nullable and 0 is a real answer — printing
                    "0%" for "did not say" would read as certainty about being
                    wrong.
                  */}
                  {typeof row.confidence === "number" && (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {Math.round(row.confidence * 100)}% confident
                    </Text>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Textile library",
  icon: Swatch,
})

export default TextileAnalysesPage
