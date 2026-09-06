import type { ComponentType } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import type { GraphNode } from "../../hooks/api/graph"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"
import { CreateDesignTaskComponent } from "../creates/create-design-task"

/**
 * Node type → the real create form for it.
 *
 * These are the SAME components their own routes render. They became usable
 * here by taking their chrome from context instead of importing
 * `RouteFocusModal` directly, so one form now serves both surfaces and there
 * is no second copy to drift.
 *
 * 🔴 A form only belongs here once it is chrome-agnostic. Added before that,
 * it renders focus-modal markup inside a stacked modal and NAVIGATES on
 * success, closing the graph that opened it.
 */
const CREATE_FORMS: Record<string, ComponentType> = {
  task: CreateDesignTaskComponent,
}

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
  const queryClient = useQueryClient()
  const CreateForm = CREATE_FORMS[node.type]

  // Something to create here means either a real form for this node type, or
  // an absent edge whose action names the step. Neither: nothing to offer.
  if (!CreateForm && (node.state !== "absent" || !node.action)) {
    return null
  }

  // Bound once so the fallback branch narrows: inside it there is no form, so
  // the guard above guarantees an action — but that is not something TS can
  // see across the JSX branch.
  const action = node.action
  const modalId = `graph-create-${node.key}`
  const triggerLabel =
    node.state === "absent"
      ? `Create the missing ${node.label.toLowerCase()}`
      : `Add to ${node.label.toLowerCase()}`

  return (
    <div className="border-t px-6 py-3">
      <StackedFocusModal
        id={modalId}
        /*
         * 🔴 Refetch the graph when this layer closes.
         *
         * The create hooks invalidate their own resource's keys and know
         * nothing about `["graph", …]`, so without this the neighbour is
         * created, the modal closes onto the graph — and the node still reads
         * its old count. Save works, screen stale: the exact failure that
         * `...options` after `onSuccess` produces in 165 admin hooks.
         *
         * Invalidating on CLOSE rather than on success covers every form
         * uniformly, including ones that create more than one thing before the
         * user is done.
         */
        onOpenChangeCallback={(open) => {
          if (!open) {
            queryClient.invalidateQueries({ queryKey: ["graph"] })
          }
        }}
      >
        <StackedFocusModal.Trigger asChild>
          <Button variant="primary" size="small">
            {triggerLabel}
          </Button>
        </StackedFocusModal.Trigger>

        <StackedFocusModal.Content>
          {CreateForm ? (
            /*
              The form supplies its own header, body and footer through the
              chrome context this stacked modal provides, and its success
              closes only this layer — the drawer and the graph stay put.
            */
            <CreateForm />
          ) : action ? (
            <>
          <StackedFocusModal.Header>
            <StackedFocusModal.Title asChild>
              <Heading level="h2">{action.label}</Heading>
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

            {action.href ? (
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
              {action.href ? (
                <Link to={action.href}>
                  <Button variant="primary" size="small">
                    {action.label}
                  </Button>
                </Link>
              ) : (
                <Button variant="primary" size="small" disabled>
                  {action.label}
                </Button>
              )}
            </div>
          </StackedFocusModal.Footer>
            </>
          ) : null}
        </StackedFocusModal.Content>
      </StackedFocusModal>
    </div>
  )
}
