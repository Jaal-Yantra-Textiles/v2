import { MedusaError } from "@medusajs/framework/utils"

import { designSpine } from "./spines/design"
import type { Graph, SpineDescriptor } from "./types"

/**
 * Every spine the graph can centre on.
 *
 * Adding one is a single entry here plus its resolver — no new route, no new
 * admin hook, and the MCP `get_entity_neighbours` tool picks it up for free.
 * That is the whole point of the registry: the surfaces consume the resolver,
 * so they cannot drift apart as spines are added.
 *
 * Next in line is Partner — the biggest node in the platform at 18 links.
 */
export const SPINES: Record<string, SpineDescriptor> = {
  [designSpine.key]: designSpine,
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
  return spine.resolve({ scope, id })
}
