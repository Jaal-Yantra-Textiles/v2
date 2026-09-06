import { Button, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import type { GraphNode } from "../../hooks/api/graph"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"

/**
 * CREATE, stacked on top of the node drawer (#1847 step 2).
 *
 * Only an ABSENT node has anything to create — a present one is opened, not
 * made. So this renders for absent nodes only; anywhere else it would be a
 * button that does nothing.
 *
 * 🔴 `StackedFocusModal.Trigger` MUST live inside its own Root. Placed outside
 * one it closes the modal underneath instead of opening anything, which reads
 * as "the button is dead" rather than as a nesting mistake. The Root also
 * needs the `StackedModalProvider` that `RouteDrawer` supplies, which is why
 * this is only ever rendered from inside the drawer.
 *
 * The modal carries the EVIDENCE across: the reason the edge is dashed and the
 * properties that justify it. The reader should not have to remember why they
 * opened it, and the create step is exactly where that context is worth most.
 */
export const GraphCreateModal = ({ node }: { node: GraphNode }) => {
  if (node.state !== "absent" || !node.action) {
    return null
  }

  const modalId = `graph-create-${node.key}`

  return (
    <div className="border-t px-6 py-3">
      <StackedFocusModal id={modalId}>
        <StackedFocusModal.Trigger asChild>
          <Button variant="primary" size="small">
            Create the missing {node.label.toLowerCase()}
          </Button>
        </StackedFocusModal.Trigger>

        <StackedFocusModal.Content>
          <StackedFocusModal.Header>
            <StackedFocusModal.Title asChild>
              <Heading level="h2">{node.action.label}</Heading>
            </StackedFocusModal.Title>
            <StackedFocusModal.Description>
              {node.label} is expected here and does not exist.
            </StackedFocusModal.Description>
          </StackedFocusModal.Header>

          <StackedFocusModal.Body className="flex flex-col gap-y-4 overflow-y-auto px-6 py-6">
            <div className="divide-y rounded-lg border">
              {node.props.map((p) => (
                <div
                  key={p.key}
                  className="flex items-center justify-between gap-x-2 px-4 py-2"
                >
                  <Text size="xsmall" className="text-ui-fg-muted truncate">
                    {p.key}
                  </Text>
                  <Text size="small" weight="plus" className="truncate">
                    {p.value}
                  </Text>
                </div>
              ))}
            </div>

            {node.action.href ? (
              <Text size="small" className="text-ui-fg-subtle">
                This opens the flow that creates it. The edge stops being dashed
                once the neighbour exists.
              </Text>
            ) : (
              /*
               * Honest about the gap rather than hiding it. Several absent
               * edges name a step the admin has no route for yet — saying so
               * is more useful than a button that silently does nothing.
               */
              <Text size="small" className="text-ui-fg-subtle">
                There is no admin route for this step yet, so it has to be done
                from the section on the design page.
              </Text>
            )}
          </StackedFocusModal.Body>

          <StackedFocusModal.Footer>
            <div className="flex items-center justify-end gap-x-2">
              <StackedFocusModal.Close asChild>
                <Button variant="secondary" size="small">
                  Cancel
                </Button>
              </StackedFocusModal.Close>
              {node.action.href ? (
                <Link to={node.action.href}>
                  <Button variant="primary" size="small">
                    {node.action.label}
                  </Button>
                </Link>
              ) : (
                <Button variant="primary" size="small" disabled>
                  {node.action.label}
                </Button>
              )}
            </div>
          </StackedFocusModal.Footer>
        </StackedFocusModal.Content>
      </StackedFocusModal>
    </div>
  )
}
