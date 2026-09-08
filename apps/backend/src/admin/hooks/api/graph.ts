import {
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from "@tanstack/react-query"
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
  /** A job this node can RUN. Mirrors `NodeAct` in `src/lib/graph/types.ts`. */
  act?: NodeAct | null
}

/**
 * A two-press operation offered on a node: preview, then apply.
 *
 * 🔴 Both bodies come from the SERVER and are sent verbatim — the client never
 * flips `dry_run` itself. The whole point of shipping two named bodies is that
 * the call which writes is a different value chosen by a different press, not
 * the same object with a mutated flag.
 */
export type NodeAct = {
  method: "POST"
  path: string
  previewBody: Record<string, unknown> | null
  /** Null where the act has nothing to apply — render no apply button at all. */
  applyBody: Record<string, unknown> | null
  label: string
  confirm: string
}

/** What a maintenance-job run answers with. */
export type NodeActResult = {
  result: {
    job_id: string
    dry_run: boolean
    applied: boolean
    summary: string
    changes: Array<{ id: string; note?: string }>
  }
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
    /** Node keys whose members can be listed. See `Graph.itemNodes` server-side. */
    itemNodes: string[]
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

/**
 * One MEMBER of an aggregate node, and how to detach it.
 *
 * Mirrors `NodeItem` / `NodeItemRemoval` in `src/lib/graph/types.ts`.
 *
 * 🔴 `remove.path` is built by the SERVER and used verbatim. The client never
 * assembles it: the four removal endpoints behind these rows take four
 * different shapes (a link-row id, a record id, a body with a list, a body
 * with a flag), and a client that guessed between them would send a
 * well-formed request to the wrong record.
 */
export type NodeItemRemoval = {
  method: "DELETE" | "POST"
  path: string
  body: Record<string, unknown> | null
  label: string
  confirm: string
}

export type NodeItem = {
  id: string
  label: string
  sublabel: string | null
  status: string | null
  href: string | null
  props: GraphProp[]
  remove: NodeItemRemoval | null
}

export type AdminGraphItemsResponse = { items: NodeItem[] }

export const graphItemsQueryKey = (spine: string, id: string, node: string) =>
  ["graph", spine, id, "items", node] as const

/**
 * The rows behind one node.
 *
 * `enabled` is the caller's, because the drawer mounts for EVERY node and only
 * some of them have members. Fetching unconditionally would fire a request per
 * selection and answer `[]` for the single-record nodes — cheap, but it would
 * also make "no members" and "not loaded yet" the same state on screen.
 */
export const useGraphNodeItems = (
  spine: string,
  id: string,
  node: string,
  options?: Omit<
    UseQueryOptions<
      AdminGraphItemsResponse,
      FetchError,
      AdminGraphItemsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: graphItemsQueryKey(spine, id, node),
    queryFn: async () =>
      sdk.client.fetch<AdminGraphItemsResponse>(
        `/admin/graph/${spine}/${id}/items/${node}`,
        { method: "GET" },
      ),
    ...options,
  })
  return { items: data?.items ?? [], ...rest }
}

/**
 * Detach one member, through the endpoint the server named.
 *
 * 🔴 Invalidates BOTH the item list and the graph itself. Removing the last
 * inventory item does not just shorten a list — it can flip the node from
 * `present` to `absent` and add a dashed edge to the canvas. Invalidating only
 * the rows would leave the graph behind the drawer asserting a link that no
 * longer exists, which is precisely the class of lie this whole view was built
 * to remove.
 *
 * 🔴 `...options` goes BEFORE `onSuccess`, never after. Spread last, it
 * overwrites the invalidation with the caller's handler and the screen stays
 * stale until a hard refresh — the bug that was live in 165 admin hooks.
 */
export const useRemoveGraphNodeItem = (
  spine: string,
  id: string,
  node: string,
  options?: UseMutationOptions<unknown, FetchError, NodeItemRemoval>,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (removal: NodeItemRemoval) =>
      sdk.client.fetch(removal.path, {
        method: removal.method,
        ...(removal.body ? { body: removal.body } : {}),
      }),
    ...options,
    /*
     * Forwarded with a rest spread rather than the three named parameters:
     * react-query's mutation callbacks gained a fourth argument, and naming
     * three would quietly drop it for every caller that passes an `onSuccess`.
     */
    onSuccess: (...args: Parameters<NonNullable<typeof options>["onSuccess"] & {}>) => {
      queryClient.invalidateQueries({
        queryKey: graphItemsQueryKey(spine, id, node),
      })
      queryClient.invalidateQueries({ queryKey: graphQueryKeys.detail(spine, id) })
      options?.onSuccess?.(...args)
    },
  })
}

/**
 * Run the job a node offers, through the path the server named.
 *
 * 🔴 Invalidates the graph and the node's rows on success, and does it for the
 * PREVIEW as well as the apply. A dry run writes nothing, but the sweep behind
 * this board records a run — so the board's "last swept" is stale the moment a
 * preview returns, and a board that states a time it no longer means is worse
 * than one that states none.
 *
 * 🔴 `...options` BEFORE `onSuccess`. Spread after, the caller's handler
 * silently replaces the invalidation and the screen stays stale until a hard
 * refresh — the defect that was live in 165 admin hooks (#1800).
 */
export const useRunGraphNodeAct = (
  spine: string,
  id: string,
  options?: UseMutationOptions<NodeActResult, FetchError, { act: NodeAct; apply: boolean }>,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ act, apply }: { act: NodeAct; apply: boolean }) => {
      const body = apply ? act.applyBody : act.previewBody
      return sdk.client.fetch<NodeActResult>(act.path, {
        method: act.method,
        ...(body ? { body } : {}),
      })
    },
    ...options,
    onSuccess: (...args: Parameters<NonNullable<typeof options>["onSuccess"] & {}>) => {
      queryClient.invalidateQueries({ queryKey: graphQueryKeys.detail(spine, id) })
      queryClient.invalidateQueries({ queryKey: ["graph", spine, id, "items"] })
      return options?.onSuccess?.(...args)
    },
  })
}
