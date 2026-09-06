import { Badge, Button, IconButton, Skeleton, Text, toast, usePrompt } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { Trash } from "@medusajs/icons"

import {
  useGraphNodeItems,
  useRemoveGraphNodeItem,
  type GraphNode,
  type NodeItem,
  type NodeItemRemoval,
} from "../../hooks/api/graph"

/**
 * The MEMBERS behind an aggregate node — and the only place in the graph that
 * can take one off (#1847 step 4).
 *
 * Until this existed the graph could only ADD. Every removal in the admin lived
 * on a summary card, which is why those cards could not be retired: "the graph
 * adds; only these can REMOVE" was the standing reason the design page still
 * stacked them. This closes that.
 *
 * 🔴 It renders NOTHING at all for a node with no member list. Not an empty
 * panel, not "0 items" — those read as "this node has nothing", which on
 * `product` or `revision` (single records, no rows) would be a lie about a
 * present, populated neighbour. The caller decides via `graph.itemNodes`.
 */

const RemoveButton = ({
  item,
  removal,
  onRemove,
  isPending,
}: {
  item: NodeItem
  removal: NodeItemRemoval
  onRemove: (r: NodeItemRemoval) => void
  isPending: boolean
}) => {
  const prompt = usePrompt()

  /*
   * 🔴 The confirm text is the SERVER's, not a generic "Are you sure?".
   * These four endpoints are not equivalent: unlinking inventory releases
   * nothing, but cancelling a partner assignment cancels their live runs and
   * every open task on them. A shared dialog would describe the mildest of
   * them and be wrong about the rest — and the reader would only find out
   * afterwards.
   */
  const confirm = async () => {
    const ok = await prompt({
      title: removal.label,
      description: removal.confirm,
      confirmText: removal.label,
      cancelText: "Keep",
    })
    if (!ok) return
    onRemove(removal)
  }

  return (
    <IconButton
      size="small"
      variant="transparent"
      disabled={isPending}
      onClick={confirm}
      aria-label={`${removal.label} ${item.label}`}
    >
      <Trash />
    </IconButton>
  )
}

export const NodeItemList = ({
  spine,
  id,
  node,
}: {
  spine: string
  id: string
  node: GraphNode
}) => {
  const { items, isLoading, isError, error } = useGraphNodeItems(spine, id, node.key)
  const { mutate, isPending } = useRemoveGraphNodeItem(spine, id, node.key, {
    onSuccess: () => toast.success("Removed"),
    /*
     * 🔴 The server's message, surfaced. Several of these refusals are
     * legitimate and specific — an applied consumption log answers "correct it
     * with a reversing entry, not an edit". Swallowing that into "Something
     * went wrong" would turn a useful instruction into a dead button.
     */
    onError: (e) => toast.error(e?.message ?? "The removal failed"),
  })

  if (isLoading) {
    return (
      <div className="flex flex-col gap-y-2 border-t px-6 py-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  /* Never render a failure as emptiness — the same rule as the canvas itself. */
  if (isError) {
    return (
      <div className="border-t px-6 py-4">
        <Text size="small">These items could not be loaded.</Text>
        <Text size="xsmall" className="text-ui-fg-muted mt-1 break-words">
          {(error as Error | undefined)?.message ?? "The request returned nothing."}
        </Text>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="border-t px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Nothing linked yet.
        </Text>
      </div>
    )
  }

  return (
    <div className="border-t">
      <div className="flex items-center justify-between px-6 py-3">
        <Text size="xsmall" weight="plus" className="text-ui-fg-muted uppercase">
          {node.label}
        </Text>
        <Badge size="2xsmall" color="grey" rounded="full">
          {items.length}
        </Badge>
      </div>
      <div className="divide-y border-t">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-x-2 px-6 py-2"
          >
            <div className="flex min-w-0 flex-col">
              {/*
                A row links out only where the target is a real page. Several
                item types (`materials`) have no admin route of their own, and
                a link that goes nowhere reads as a broken one.
              */}
              {item.href ? (
                <Link to={item.href} className="truncate">
                  <Text size="small" weight="plus" className="truncate hover:underline">
                    {item.label}
                  </Text>
                </Link>
              ) : (
                <Text size="small" weight="plus" className="truncate">
                  {item.label}
                </Text>
              )}
              {item.sublabel && (
                <Text size="xsmall" className="text-ui-fg-muted truncate">
                  {item.sublabel}
                </Text>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-x-1">
              {item.status && (
                <Badge size="2xsmall" color="grey" rounded="full">
                  {item.status}
                </Badge>
              )}
              {/*
                🔴 No button where `remove` is null, and the reasons differ:
                a `used_in` bundle row is owned by the PARENT design, an
                applied consumption log has already moved stock, an order is
                history. Rendering a disabled button on all three would imply
                one shared "not yet" — they are three different permanent
                answers.
              */}
              {item.remove && (
                <RemoveButton
                  item={item}
                  removal={item.remove}
                  onRemove={mutate}
                  isPending={isPending}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The "and another" affordance.
 *
 * The graph could send an unstarted design to production but had nowhere to
 * create a SECOND run beside the ones that exist — the one job that kept the
 * production-runs summary card on the design page. An absent node names the
 * step that would create the first of a thing; this names the step that
 * creates the next one.
 *
 * 🔴 Only on a PRESENT node. On an absent node the create form or the action
 * rail is already asking for exactly this, and a second button beside it
 * saying almost the same words is how the workspace ended up offering "Create
 * the missing inventory" directly above "Link inventory".
 */
export const NodeAddAnother = ({
  node,
  label,
  href,
}: {
  node: GraphNode
  label: string
  href: string
}) => {
  if (node.state === "absent") {
    return null
  }
  return (
    <div className="border-t px-6 py-3">
      <Link to={href}>
        <Button variant="secondary" size="small">
          {label}
        </Button>
      </Link>
    </div>
  )
}
