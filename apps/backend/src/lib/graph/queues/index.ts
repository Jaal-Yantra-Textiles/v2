import { MedusaError } from "@medusajs/framework/utils"

import type { Graph, NodeItem, SpineContext, SpineDescriptor } from "../types"
import { productsAwaitingItems, resolveProductsAwaiting } from "./products-awaiting"
import { runsRejectedItems, resolveRunsRejected } from "./runs-rejected"

/**
 * QUEUES: graphs centred on a population rather than on one record (#1856).
 *
 * A queue is a spine whose `id` is the queue's NAME instead of a record id.
 * That is the whole trick, and it is deliberate: `/admin/graph/queue/:key`
 * already exists, `useEntityGraph("queue", key)` already exists, and the
 * canvas, viewport, inspector, member drawer and node forms are all
 * spine-agnostic and already take the spine key as a prop. A cohort board
 * therefore costs a resolver and a registry entry — no route, no hook, no
 * client change — which is the same claim the spine registry made and this is
 * the test of it from a direction its author did not anticipate.
 *
 * 🔴 An unknown queue is a 404 naming the known ones, never an empty graph. An
 * empty graph would be indistinguishable from "the queue is clear", and telling
 * a reader their backlog is empty when they have merely mistyped it is the
 * precise failure this whole feature exists to remove.
 */
type QueueDescriptor = {
  key: string
  label: string
  resolve: (ctx: SpineContext) => Promise<Graph>
  items?: (ctx: SpineContext, nodeKey: string) => Promise<NodeItem[]>
  itemNodes?: string[]
}

const QUEUES: Record<string, QueueDescriptor> = {
  "products-awaiting": {
    key: "products-awaiting",
    label: "Products awaiting creation",
    resolve: resolveProductsAwaiting,
    items: productsAwaitingItems,
  },
  "runs-rejected": {
    key: "runs-rejected",
    label: "Rejected production runs",
    resolve: resolveRunsRejected,
    items: runsRejectedItems,
  },
}

export const QUEUE_KEYS = Object.keys(QUEUES)

const queueOrThrow = (id: string): QueueDescriptor => {
  const q = QUEUES[id]
  if (!q) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Unknown queue "${id}". Known queues: ${QUEUE_KEYS.join(", ")}`
    )
  }
  return q
}

/**
 * The queue spine.
 *
 * `itemNodes` cannot be a fixed list here the way it is for a record spine: the
 * nodes are `design:<id>`, one per member of the cohort, and their keys are not
 * known until the graph is resolved. The route fills it from the resolved
 * graph instead — see `SPINES.queue.resolve` below.
 */
export const queueSpine: SpineDescriptor = {
  key: "queue",
  label: "Queue",
  resolve: async (ctx) => {
    const graph = await queueOrThrow(ctx.id).resolve(ctx)
    /*
     * Every drawn node can list its members, so the drawer asks for all of
     * them. Declared from the resolved graph rather than hard-coded, because
     * the node keys are the cohort and the cohort changes with the data.
     */
    return { ...graph, itemNodes: graph.nodes.map((n) => n.key) }
  },
  items: async (ctx, nodeKey) => {
    const q = queueOrThrow(ctx.id)
    return q.items ? q.items(ctx, nodeKey) : []
  },
}
