import { MedusaError } from "@medusajs/framework/utils"

import { designSpine } from "./spines/design"
import { partnerSpine } from "./spines/partner"
import { socialPlatformSpine } from "./spines/social-platform"
import { websiteSpine } from "./spines/website"
import type { Graph, NodeItem, SpineDescriptor } from "./types"

/**
 * Every spine the graph can centre on.
 *
 * Adding one is a single entry here plus its resolver — no new route, no new
 * admin hook, and the MCP `get_entity_neighbours` tool picks it up for free.
 * That is the whole point of the registry: the surfaces consume the resolver,
 * so they cannot drift apart as spines are added.
 *
 * Partner joined as the second spine and cost exactly that: one entry here
 * and a resolver. No route, no hook, no client change — which is the claim the
 * registry was making all along, now tested by something other than its author.
 */
export const SPINES: Record<string, SpineDescriptor> = {
  [designSpine.key]: designSpine,
  [partnerSpine.key]: partnerSpine,
  [websiteSpine.key]: websiteSpine,
  [socialPlatformSpine.key]: socialPlatformSpine,
}

export const SPINE_KEYS = Object.keys(SPINES)

/**
 * Resolve one entity's neighbours.
 *
 * 🔴 An unknown spine is a 404 with the valid keys named, not an empty graph.
 * An empty graph is indistinguishable from "this entity genuinely has no
 * neighbours", which is precisely the confusion this whole view exists to
 * remove.
 */
export const resolveGraph = async (
  scope: any,
  spineKey: string,
  id: string
): Promise<Graph> => {
  const spine = SPINES[spineKey]
  if (!spine) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Unknown graph spine "${spineKey}". Known spines: ${SPINE_KEYS.join(", ")}`
    )
  }
  const graph = await spine.resolve({ scope, id })
  /*
   * Attached HERE rather than in each spine's `build()` call, so a spine that
   * gains an item resolver cannot forget to advertise it — a graph whose
   * `itemNodes` disagreed with its `items()` would render drawers that fetch
   * nothing, or nodes whose rows exist and are never asked for.
   */
  return { ...graph, itemNodes: spine.itemNodes ?? [] }
}

/**
 * The members behind one aggregate node.
 *
 * 🔴 An unknown SPINE is a 404, exactly as above — but an unknown NODE is an
 * empty list, not an error. The two are genuinely different questions. A bad
 * spine key means the caller asked for something that does not exist; a node
 * with no item resolver means "this aggregate has no rows worth listing",
 * which is a legitimate answer for the nodes that are a single record
 * (`product`, `revision`) or a pure count (`palette`). Raising here would turn
 * every one of those into a red panel in the drawer.
 */
export const resolveGraphItems = async (
  scope: any,
  spineKey: string,
  id: string,
  nodeKey: string
): Promise<NodeItem[]> => {
  const spine = SPINES[spineKey]
  if (!spine) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Unknown graph spine "${spineKey}". Known spines: ${SPINE_KEYS.join(", ")}`
    )
  }
  if (!spine.items) {
    return []
  }
  return spine.items({ scope, id }, nodeKey)
}
