import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  Container,
  Heading,
  Input,
  Select,
  Skeleton,
  Text,
} from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { getThumbUrl, isImageUrl } from "../../lib/media"

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

/**
 * The "no filter" option's value.
 *
 * 🔴 NOT `""`. Radix — which `Select` is built on — reserves the empty string
 * for "cleared, show the placeholder" and throws on a `Select.Item` that uses
 * it, so the whole screen died in an error boundary the moment it rendered.
 * A sentinel says the same thing without colliding with that meaning, and is
 * dropped when the query string is built so it never reaches the API as
 * `field=`.
 */
const ANY = "__any__"

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
   * been opened and cleared would silently empty the catalogue.
   */
  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) {
      if (v && v !== ANY) params.set(k, v)
    }
    if (search.trim()) params.set("q", search.trim())
    params.set("limit", "200")
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
            filterable by garment, pattern, weight and construction. Click a
            tile to correct it.
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
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {Array.from({ length: 16 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-10">
            <Text className="text-ui-fg-subtle">
              Nothing matches those filters.
            </Text>
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
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {rows.map((row) => {
                const name = row.title ?? row.media?.file_name ?? "Untitled"
                return (
                  <Link
                    key={row.id}
                    to={`/textile-analyses/${row.id}`}
                    className="group relative block aspect-square overflow-hidden rounded-md outline-none focus-visible:shadow-borders-interactive-with-focus"
                    aria-label={name}
                    title={name}
                    data-testid="textile-card"
                  >
                    {row.media?.file_path && isImageUrl(row.media.file_path) ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={getThumbUrl(row.media.file_path, {
                          width: 256,
                          quality: 65,
                          fit: "cover",
                        })}
                        alt={name}
                        loading="lazy"
                        className="size-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="bg-ui-bg-base-pressed flex size-full items-center justify-center rounded-md">
                        <Text size="xsmall" className="text-ui-fg-muted">
                          no image
                        </Text>
                      </div>
                    )}
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </div>
    </Container>
  )
}

export default TextileAnalysesPage