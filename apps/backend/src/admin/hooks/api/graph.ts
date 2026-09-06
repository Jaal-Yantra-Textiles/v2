import { QueryKey, useQuery, UseQueryOptions } from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"

import { sdk } from "../../lib/config"

/**
 * The entity graph, for any registered spine (#1847).
 *
 * Mirrors `src/lib/graph/types.ts` on the server. One hook for every spine —
 * design today, partner next — so a new spine needs no new hook and the two
 * surfaces cannot drift.
 */
export type GraphEdgeState = "present" | "derived" | "absent"

export type GraphProp = { key: string; value: string }

export type GraphNode = {
  key: string
  type: string
  label: string
  sublabel: string | null
  state: GraphEdgeState
  count: number
  status: string | null
  href: string | null
  props: GraphProp[]
  action: { label: string; href: string | null } | null
}

export type GraphEdge = {
  from: string
  to: string
  label: string
  state: GraphEdgeState
  reason: string | null
}

export type AdminGraphResponse = {
  graph: {
    spine: GraphNode
    nodes: GraphNode[]
    edges: GraphEdge[]
    summary: { links: number; absent: number; derived: number }
  }
}

export const graphQueryKeys = {
  detail: (spine: string, id: string) => ["graph", spine, id] as const,
}

export const useEntityGraph = (
  spine: string,
  id: string,
  options?: Omit<
    UseQueryOptions<AdminGraphResponse, FetchError, AdminGraphResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: graphQueryKeys.detail(spine, id),
    queryFn: async () =>
      sdk.client.fetch<AdminGraphResponse>(`/admin/graph/${spine}/${id}`, {
        method: "GET",
      }),
    ...options,
  })
  return { ...data, ...rest }
}
