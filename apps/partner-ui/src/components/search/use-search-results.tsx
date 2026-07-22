import { useEffect, useMemo, useState } from "react"
import { useQueries } from "@tanstack/react-query"
import { Shortcut, ShortcutType } from "../../providers/keybind-provider"
import { useGlobalShortcuts } from "../../providers/keybind-provider/hooks"
import { sdk } from "../../lib/client"
import { DATA_SEARCH_AREAS } from "./constants"
import {
  DynamicSearchResult,
  DynamicSearchResultItem,
  SearchArea,
} from "./types"

type UseSearchProps = {
  q?: string
  limit: number
  area?: SearchArea
}

type DataSearchArea = (typeof DATA_SEARCH_AREAS)[number]

type EntityConfig = {
  area: DataSearchArea
  title: string
  endpoint: string
  listKey: string
  mapItem: (item: any, area: DataSearchArea) => DynamicSearchResultItem
}

const displayName = (customer: any): string => {
  const name = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()

  return name || customer.company_name || customer.email || customer.id
}

const ENTITY_CONFIGS: EntityConfig[] = [
  {
    area: "orders",
    title: "Orders",
    endpoint: "/partners/orders",
    listKey: "orders",
    mapItem: (order, area) => ({
      id: order.id,
      title: `#${order.display_id ?? order.id}`,
      subtitle: order.email ?? undefined,
      to: `/orders/${order.id}`,
      value: `${area}:${order.id}`,
    }),
  },
  {
    area: "designs",
    title: "Designs",
    endpoint: "/partners/designs",
    listKey: "designs",
    mapItem: (design, area) => ({
      id: design.id,
      title: design.name ?? design.id,
      subtitle: design.status ?? undefined,
      to: `/designs/${design.id}`,
      thumbnail: design.thumbnail ?? undefined,
      value: `${area}:${design.id}`,
    }),
  },
  {
    area: "inventory",
    title: "Inventory",
    endpoint: "/partners/inventory-items",
    listKey: "inventory_items",
    mapItem: (item, area) => ({
      id: item.id,
      title: item.title ?? item.sku ?? item.id,
      subtitle: item.sku ?? undefined,
      to: `/inventory/${item.id}`,
      thumbnail: item.thumbnail ?? undefined,
      value: `${area}:${item.id}`,
    }),
  },
  {
    area: "customers",
    title: "Customers",
    endpoint: "/partners/customers",
    listKey: "customers",
    mapItem: (customer, area) => ({
      id: customer.id,
      title: displayName(customer),
      subtitle: customer.email ?? undefined,
      to: `/customers/${customer.id}`,
      value: `${area}:${customer.id}`,
    }),
  },
]

const useDebouncedValue = <T,>(value: T, delay = 300): T => {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(handle)
  }, [value, delay])

  return debounced
}

export const useSearchResults = (props: UseSearchProps) => {
  const area = props.area ?? "all"
  const staticResults = useStaticSearchResults(area)
  const dynamic = useDynamicSearchResults(props.q, props.limit, area)

  return {
    staticResults,
    dynamicResults: dynamic.results,
    isFetching: dynamic.isFetching,
  }
}

const useDynamicSearchResults = (
  rawQuery: string | undefined,
  limit: number,
  area: SearchArea
) => {
  const q = useDebouncedValue((rawQuery ?? "").trim())
  const enabled = q.length > 0

  // "all" fans out to every entity; a specific data area targets just that one.
  const activeConfigs = useMemo(() => {
    if (area === "all") {
      return ENTITY_CONFIGS
    }

    return ENTITY_CONFIGS.filter((config) => config.area === area)
  }, [area])

  const queries = useQueries({
    queries: activeConfigs.map((config) => ({
      queryKey: ["partner-search", config.area, q, limit] as const,
      queryFn: () =>
        sdk.client.fetch<Record<string, any>>(config.endpoint, {
          method: "GET",
          query: { q, limit },
        }),
      enabled,
      staleTime: 30_000,
    })),
  })

  const dataUpdatedAt = queries.map((query) => query.dataUpdatedAt).join(",")

  const results = useMemo<DynamicSearchResult[]>(() => {
    return activeConfigs.reduce<DynamicSearchResult[]>((acc, config, index) => {
      const data = queries[index]?.data
      const items = (data?.[config.listKey] ?? []) as any[]

      if (!items.length) {
        return acc
      }

      const count = typeof data?.count === "number" ? data.count : items.length

      acc.push({
        area: config.area,
        title: config.title,
        count,
        hasMore: count > items.length,
        items: items.map((item) => config.mapItem(item, config.area)),
      })

      return acc
    }, [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConfigs, dataUpdatedAt])

  const isFetching = enabled && queries.some((query) => query.isFetching)

  return { results, isFetching }
}

const useStaticSearchResults = (currentArea: SearchArea) => {
  const globalCommands = useGlobalShortcuts()

  const results = useMemo(() => {
    const groups = new Map<ShortcutType, Shortcut[]>()

    globalCommands.forEach((command) => {
      const group = groups.get(command.type) || []
      group.push(command)
      groups.set(command.type, group)
    })

    let filteredGroups: [ShortcutType, Shortcut[]][]

    switch (currentArea) {
      case "all":
        filteredGroups = Array.from(groups)
        break
      case "navigation":
        filteredGroups = Array.from(groups).filter(
          ([type]) => type === "pageShortcut" || type === "settingShortcut"
        )
        break
      case "command":
        filteredGroups = Array.from(groups).filter(
          ([type]) => type === "commandShortcut"
        )
        break
      default:
        filteredGroups = []
    }

    return filteredGroups.map(([title, items]) => ({
      title,
      items,
    }))
  }, [globalCommands, currentArea])

  return results
}
