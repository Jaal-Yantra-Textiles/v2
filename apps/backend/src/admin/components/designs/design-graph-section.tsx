import type { AdminDesign } from "../../hooks/api/designs"
import { EntityGraph } from "../graph/entity-graph"

/**
 * The design spine, rendered by the shared graph (#1847).
 *
 * A thin caller by design: the node/edge construction lives server-side in
 * `src/lib/graph/spines/design`, and the canvas is `EntityGraph`. Adding the
 * Partner spine means registering a resolver and passing `spine="partner"` —
 * no second component, and no second copy of the rules to fall out of step.
 */
export const DesignGraphSection = ({ design }: { design: AdminDesign }) => (
  <EntityGraph
    spine="design"
    id={design.id}
    expandHref={`/designs/${design.id}/graph`}
  />
)
