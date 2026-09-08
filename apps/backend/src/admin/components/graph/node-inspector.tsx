import { useState } from "react"
import { Badge, Button, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { useRunGraphNodeAct } from "../../hooks/api/graph"
import type { GraphEdge, GraphNode, NodeActResult } from "../../hooks/api/graph"
import { actRail, canApply } from "./node-forms"
import type { ActionRail } from "./node-forms"

/**
 * What one node says about itself: its properties, why its edge is dashed, and
 * the action that would make the edge real.
 *
 * Shared by the in-page inspector column and the workspace's RouteDrawer, so
 * the reason text a reader sees is the same in both places.
 */

export const NodeInspectorBody = ({
  node,
  edge,
}: {
  node: GraphNode
  edge?: GraphEdge
}) => (
  <>
    <div className="divide-y border-t">
      {node.props.map((p) => (
        <div
          key={p.key}
          className="flex items-center justify-between gap-x-2 px-6 py-2"
        >
          {/*
            🔴 `shrink-0` with a cap, not a bare `truncate`. Two truncating
            halves of a flex row shrink in proportion to their content, so a
            long value eats its own label: the dangling board's sweep summary
            rendered its key as "S…" — a row with a value and no name. The cap
            keeps a runaway key from doing the same thing in reverse.
          */}
          <Text
            size="xsmall"
            className="text-ui-fg-muted truncate shrink-0 max-w-[45%]"
          >
            {p.key}
          </Text>
          <Text size="small" weight="plus" className="truncate">
            {p.value}
          </Text>
        </div>
      ))}
    </div>

    {edge?.reason && (
      <div className="border-t px-6 py-3">
        <Text size="xsmall" className="text-ui-fg-subtle">
          {edge.reason}
        </Text>
      </div>
    )}
  </>
)

/**
 * The action rail. An absent node's action names the thing that would create
 * the missing neighbour; `open` is a drill-in to the neighbour's own page.
 *
 * `mode` is decided by `actionRail` in `node-forms.ts` — which of the two (if
 * either) earns a button depends on whether a form is already offered beside
 * it and on whether the href goes anywhere new. Defaults to the old behaviour
 * for the in-page inspector, which offers no forms.
 *
 * An action with no href renders DISABLED rather than being hidden — the
 * reader should still learn what the missing step is called even where the
 * admin has no route for it yet.
 */
export const NodeInspectorActions = ({
  node,
  mode,
  selfHref,
  workspaceHref,
}: {
  node: GraphNode
  mode?: ActionRail
  /**
   * The page this graph is embedded IN. Any action whose href equals it is a
   * link back to where the reader already is.
   */
  selfHref?: string
  /** The full-page workspace, where the forms live. */
  workspaceHref?: string
}) => {
  const resolved: ActionRail = mode ?? (node.action ? "action" : node.href ? "open" : "none")

  if (resolved === "none") {
    return null
  }

  /*
   * 🔴 An action that points at the page you are on is a dead button.
   *
   * Every absent node on the PARTNER spine names `/partners/:id` as where to
   * go — which is correct for a reader coming from a list, and useless in the
   * card embedded on that very page: "Add a payment method" rendered as a link
   * to the partner page, from the partner page. Nothing errors; the button
   * simply does nothing, which is the same shape as the superseded link-out
   * that kept rendering beside its replacement (#1854).
   *
   * The words are kept and the destination is corrected: the workspace, opened
   * on this node, which is where its create form actually is. Where there is
   * no workspace to send them to, the button is dropped rather than left dead.
   */
  const actionHref = node.action?.href
  const isSelfLink = !!actionHref && !!selfHref && actionHref === selfHref
  const redirected = isSelfLink
    ? workspaceHref
      ? `${workspaceHref}?node=${encodeURIComponent(node.key)}`
      : null
    : actionHref

  if (resolved === "action" && isSelfLink && !redirected) {
    return null
  }

  /*
   * Nothing left to draw — return null rather than an empty bordered strip.
   * A 12px rule under the card reads as a section that failed to load.
   */
  if (resolved === "open" && (!node.href || node.href === selfHref)) {
    return null
  }

  return (
    <div className="border-t px-6 py-3">
      {resolved === "action" && node.action ? (
        redirected ? (
          <Link to={redirected}>
            <Button variant="secondary" size="small">
              {node.action.label}
            </Button>
          </Link>
        ) : (
          <Button variant="secondary" size="small" disabled>
            {node.action.label}
          </Button>
        )
      ) : node.href && node.href !== selfHref ? (
        /*
         * 🔴 `!== selfHref` for the same reason. Most present nodes on the
         * partner spine carry the partner's own page as their href, so "Open"
         * offered to open the page it is rendered on.
         */
        <Link to={node.href}>
          <Button variant="secondary" size="small">
            Open
          </Button>
        </Link>
      ) : null}
    </div>
  )
}

export const NodeInspectorHeader = ({
  node,
  isPlaceholder = false,
}: {
  node: GraphNode
  /**
   * 🔴 A placeholder is `absent` for the AFFORDANCE rules — the model can hold
   * this neighbour and there is none, which is exactly what unlocks the create
   * form and blocks the edit form. But it must not be `absent` in the WORDS.
   *
   * Rendered, the red "absent" badge sat directly above the sentence saying
   * "Nothing is wrong", which is a contradiction the reader has to resolve.
   * A real absent edge means the model EXPECTED a neighbour and it is not
   * there; a placeholder only means someone opened the Add menu.
   */
  isPlaceholder?: boolean
}) => (
  <div className="flex items-start justify-between gap-x-2 px-6 py-4">
    <div className="flex flex-col">
      <Text size="xsmall" className="text-ui-fg-muted uppercase">
        Selected
      </Text>
      <Heading level="h3" className="truncate">
        {node.label}
      </Heading>
    </div>
    <Badge
      size="2xsmall"
      rounded="full"
      color={!isPlaceholder && node.state === "absent" ? "red" : "grey"}
    >
      {isPlaceholder
        ? "none yet"
        : node.state === "absent"
          ? "absent"
          : (node.sublabel ?? "linked")}
    </Badge>
  </div>
)

/**
 * The ACT rail: a data-ops job run from the node that states the problem.
 *
 * ## Why this exists (#1856 → #1857)
 *
 * A node could previously offer a form or a LINK. That is the right pair for
 * an absence somebody fills in — "no payment method, here is the form" — and
 * it is nothing at all for a node whose answer is an operation. The partner
 * spine carries four cards drawn `derived` for exactly this reason (verify,
 * provision, apply), and the dangling board is unbuildable without it: a board
 * that can only report is the report it was meant to replace.
 *
 * ## Preview, then apply — never one press
 *
 * 🔴 The first press ALWAYS runs the preview, whatever the button says, and
 * the apply button does not exist until a preview has come back. The reason is
 * this board specifically: three sweeps running have been topped by a pair
 * that was not a defect, and the failure mode is an operator repairing correct
 * state because the count looked alarming. Making them read what would change
 * before anything changes is the only guard that survives a convincing number.
 *
 * 🔴 `applyBody: null` renders NO apply button rather than a disabled one. The
 * sweep writes nothing in either mode; a greyed-out "Apply" would imply a
 * write that is merely unavailable, when there is none to make.
 */
export const NodeInspectorAct = ({
  node,
  spine,
  id,
}: {
  node: GraphNode
  spine: string
  id: string
}) => {
  const act = node.act
  const prompt = usePrompt()
  const [preview, setPreview] = useState<NodeActResult["result"] | null>(null)

  const { mutate, isPending } = useRunGraphNodeAct(spine, id, {
    onSuccess: (data) => {
      setPreview(data.result)
      toast.success(
        data.result.applied ? "Applied" : `Preview — ${data.result.changes.length} change(s)`
      )
    },
    onError: (e: any) => toast.error(e?.message ?? "The job failed"),
  })

  if (!act) {
    return null
  }

  /*
   * 🔴 `previewBody: null` means THERE IS NO DRY RUN — not "preview with an
   * empty body".
   *
   * The first version pressed preview unconditionally, so an act with no
   * preview would have POSTed to the real endpoint with no body while the
   * button still said preview. For the two acts that arrived next — verify a
   * WhatsApp number, which SENDS A MESSAGE to a real partner, and re-verify a
   * custom domain, which pushes DNS — the safe-looking press was the whole
   * action. Caught before either was wired, and only because writing the
   * second kind of act forced the question.
   *
   * With no preview there is exactly one button and it is the act itself,
   * behind the confirm. With a preview, the apply cannot be reached until one
   * has come back.
   */
  const hasPreview = actRail(act) === "preview-then-apply"

  const runApply = async () => {
    /*
     * 🔴 The confirm sentence is the SERVER's. A generic "Are you sure?" would
     * drop the one thing worth reading — that these FX markers point at prices
     * which were REPLACED, not lost, and that the rerate job already skips
     * them. That sentence is why an operator can tell repair from destruction.
     */
    const ok = await prompt({
      title: act.label,
      description: act.confirm,
      /*
       * The act's own words where there was nothing to preview. "Apply" is
       * right for the second half of a preview-then-apply pair and wrong for a
       * single press that SENDS A WHATSAPP MESSAGE — the confirm's last word
       * should be the thing about to happen, not a stage of a flow this act
       * does not have.
       */
      confirmText: hasPreview ? "Apply" : act.label,
    })
    if (ok) {
      mutate({ act, apply: true })
    }
  }

  return (
    <div className="border-t px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {hasPreview ? (
          <Button
            variant="secondary"
            size="small"
            isLoading={isPending}
            onClick={() => mutate({ act, apply: false })}
          >
            {preview ? "Preview again" : act.label}
          </Button>
        ) : (
          /*
           * No dry run exists, so the label IS the action and it goes through
           * the confirm. `danger`, because nothing here previews first.
           */
          <Button variant="danger" size="small" isLoading={isPending} onClick={runApply}>
            {act.label}
          </Button>
        )}
        {/*
          Only after a preview, and only where there is something to apply.
        */}
        {canApply(act, !!preview) && (
          <Button variant="danger" size="small" disabled={isPending} onClick={runApply}>
            Apply
          </Button>
        )}
      </div>

      {preview && (
        <div className="mt-3 flex flex-col gap-y-1">
          <Text size="xsmall" className="text-ui-fg-subtle">
            {preview.summary}
          </Text>
          {/*
            The first few rows the job named, not just how many. A dry run that
            lists a count cannot be argued with; one that shows its reasons can
            be caught before it is applied.
          */}
          {preview.changes.slice(0, 5).map((c, i) => (
            <Text key={`${c.id}-${i}`} size="xsmall" className="text-ui-fg-muted truncate">
              {c.id}
              {c.note ? ` — ${c.note}` : ""}
            </Text>
          ))}
          {preview.changes.length > 5 && (
            <Text size="xsmall" className="text-ui-fg-muted">
              …and {preview.changes.length - 5} more.
            </Text>
          )}
        </div>
      )}
    </div>
  )
}
