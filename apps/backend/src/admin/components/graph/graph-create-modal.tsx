import { useQueryClient } from "@tanstack/react-query"
import { Button, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import type { GraphNode } from "../../hooks/api/graph"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"
import { createFormFor, editFormFor, registryFor, withArticle } from "./graph-forms"
import { nodeAffordance } from "./node-forms"

/**
 * 🔴 Refetch the graph when a form layer closes.
 *
 * The create/edit hooks invalidate their own resource's keys and know nothing
 * about `["graph", …]`, so without this the neighbour is created, the modal
 * closes onto the graph — and the node still reads its old count. Save works,
 * screen stale: the exact failure that `...options` after `onSuccess` produces
 * in 165 admin hooks.
 *
 * Invalidating on CLOSE rather than on success covers every form uniformly,
 * including ones that create more than one thing before the user is done — the
 * two link tables both stay open and let you link repeatedly.
 */
const useGraphRefetchOnClose = () => {
  const queryClient = useQueryClient()

  return (open: boolean) => {
    if (!open) {
      queryClient.invalidateQueries({ queryKey: ["graph"] })
    }
  }
}

/**
 * CREATE, stacked on top of the node drawer (#1847 step 2).
 *
 * A node offers a create form when its type has one registered for this spine.
 * Where it does not, an ABSENT node still names the step that would fill the
 * edge, and that evidence card is the fallback.
 *
 * 🔴 `StackedFocusModal.Trigger` MUST live inside its own Root. Placed outside
 * one it closes the modal underneath instead of opening anything, which reads
 * as "the button is dead" rather than as a nesting mistake. The Root also needs
 * the `StackedModalProvider` that `RouteDrawer` supplies, which is why this is
 * only ever rendered from inside the drawer.
 *
 * The modal carries the EVIDENCE across: the reason the edge is dashed and the
 * properties that justify it. The reader should not have to remember why they
 * opened it, and the create step is exactly where that context is worth most.
 */
export const GraphCreateModal = ({
  node,
  spine,
  isPlaceholder = false,
}: {
  node: GraphNode
  spine: string
  /**
   * This node is not on the canvas at all — the spine can hold this neighbour
   * and has none, so it was synthesised to offer the create form.
   *
   * 🔴 It changes the WORDS, and the words matter. A placeholder is modelled
   * as `absent` so the affordance rules treat it correctly, but "Create the
   * MISSING bundled design" would tell the reader something is wrong when
   * nothing is: a real absent edge means the model expected a neighbour and
   * there is none, while this only means you opened the menu.
   */
  isPlaceholder?: boolean
}) => {
  const onOpenChange = useGraphRefetchOnClose()
  const affordance = nodeAffordance(node, registryFor(spine))
  const CreateForm = affordance.create ? createFormFor(spine, node.key) : undefined

  if (!CreateForm && !affordance.action) {
    return null
  }

  // Bound once so the fallback branch narrows: inside it there is no form, so
  // the affordance guarantees an action — but that is not something TS can see
  // across the JSX branch.
  const action = node.action
  const modalId = `graph-create-${node.key}`
  const triggerLabel = isPlaceholder
    ? `Add ${withArticle(node.label.toLowerCase())}`
    : node.state === "absent"
      ? `Create the missing ${node.label.toLowerCase()}`
      : `Add to ${node.label.toLowerCase()}`

  return (
    <div className="border-t px-6 py-3">
      <StackedFocusModal id={modalId} onOpenChangeCallback={onOpenChange}>
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
                    This opens the flow that creates it. The edge stops being
                    dashed once the neighbour exists.
                  </Text>
                ) : (
                  /*
                   * Honest about the gap rather than hiding it. Several absent
                   * edges name a step the admin has no route for yet — saying
                   * so is more useful than a button that silently does nothing.
                   */
                  <Text size="small" className="text-ui-fg-subtle">
                    There is no admin route for this step yet, so it has to be
                    done from the section on the design page.
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

/**
 * EDIT, the other half of #1847 step 3: click a present node to change it.
 *
 * Its own stacked layer, with its own `id` — two modals sharing one id would
 * register over each other in the `StackedModalProvider` and open the wrong
 * form.
 *
 * There is deliberately no edit affordance on an ABSENT node: `nodeAffordance`
 * refuses it, because a form opened over a record that does not exist has
 * nothing to load and nothing to save to.
 */
export const GraphEditModal = ({
  node,
  spine,
}: {
  node: GraphNode
  spine: string
}) => {
  const onOpenChange = useGraphRefetchOnClose()
  const affordance = nodeAffordance(node, registryFor(spine))
  const edit = affordance.edit ? editFormFor(spine, node.key) : undefined

  if (!edit) {
    return null
  }

  const { Form: EditForm, label, title } = edit

  return (
    <div className="border-t px-6 py-3">
      <StackedFocusModal
        id={`graph-edit-${node.key}`}
        onOpenChangeCallback={onOpenChange}
      >
        <StackedFocusModal.Trigger asChild>
          <Button variant="secondary" size="small">
            {label}
          </Button>
        </StackedFocusModal.Trigger>

        <StackedFocusModal.Content>
          {/*
            The heading belongs to the modal, not the form: an edit form here
            renders only a body and a footer, exactly as it does at its own
            route where the page supplies the header. Without this the layer
            opens straight onto an input, and Radix has no dialog title to
            announce.
          */}
          <StackedFocusModal.Header>
            <StackedFocusModal.Title asChild>
              <Heading level="h2">{title}</Heading>
            </StackedFocusModal.Title>
            <StackedFocusModal.Description asChild>
              <span className="sr-only">{node.label}</span>
            </StackedFocusModal.Description>
          </StackedFocusModal.Header>
          <EditForm />
        </StackedFocusModal.Content>
      </StackedFocusModal>
    </div>
  )
}
