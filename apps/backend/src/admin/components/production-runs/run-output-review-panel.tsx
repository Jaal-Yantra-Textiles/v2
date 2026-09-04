import {
  Badge,
  Button,
  Drawer,
  Heading,
  Table,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"

import {
  useRunApprovals,
  type RunApprovalReport,
} from "../../hooks/api/production-runs"

type Decision = "approve" | "reject"

type Props = {
  decision: Decision | null
  runIds: string[]
  onClose: () => void
  /** Called after a decision has actually been applied. */
  onApplied: () => void
}

const outcomeColor = (outcome: RunApprovalReport["outcome"]) =>
  outcome === "approved"
    ? "green"
    : outcome === "rejected"
      ? "orange"
      : outcome === "failed"
        ? "red"
        : "grey"

const shortId = (id: string) => (id?.length > 12 ? `${id.slice(0, 10)}…` : id)

/**
 * Reviewing what completed runs produced, in bulk (#1805).
 *
 * ## The preview is the point, not a courtesy
 *
 * An operator selecting "all completed runs" is selecting several runs of the
 * SAME design — parent/child partner assignments, recreations — and approval
 * creates a product per design, not per run. So the count they selected and the
 * count of things that will be created are different numbers, and the
 * difference is invisible from the list. This panel asks the server what would
 * happen (`dry_run`) and shows it before anything is created: which runs map to
 * which design, which designs already have a product and will NOT be listed
 * again, and what each will be listed at.
 *
 * 🔑 The same call, run for real, returns the same per-run shape — so the
 * "before" and the "after" are the same table, and an operator can see that
 * three runs were skipped rather than reading a toast that says "Done".
 */
export const RunOutputReviewPanel = ({
  decision,
  runIds,
  onClose,
  onApplied,
}: Props) => {
  const [reason, setReason] = useState("")
  const [plan, setPlan] = useState<RunApprovalReport[] | null>(null)
  const [applied, setApplied] = useState<RunApprovalReport[] | null>(null)
  /**
   * How many runs the batch WAS, frozen at submit.
   *
   * The parent clears its selection the moment a decision lands, so reading
   * `runIds.length` afterwards reported "1 of 0 runs" — a live count describing
   * a finished batch.
   */
  const [batchSize, setBatchSize] = useState(0)

  const { mutateAsync: review, isPending } = useRunApprovals()

  const open = Boolean(decision)

  /**
   * Ask the server what this batch means, whenever the batch changes.
   *
   * 🔴 Keyed on a STRING signature, not on the array. `runIds` is rebuilt by
   * the parent on every render, so an effect depending on the array itself
   * re-fires forever — and each re-fire would wipe a reason the operator was
   * halfway through typing (#1803).
   */
  const signature = `${decision ?? ""}:${runIds.join(",")}`

  useEffect(() => {
    if (!decision || !runIds.length) {
      setPlan(null)
      return
    }
    setApplied(null)
    setReason("")
    setBatchSize(runIds.length)

    let cancelled = false
    review({
      run_ids: runIds,
      decision,
      dry_run: true,
    })
      .then((res) => {
        if (!cancelled) setPlan(res.run_approvals.runs)
      })
      .catch((e: any) => {
        if (!cancelled) {
          toast.error(e?.message ?? "Could not work out what this would do.")
          setPlan([])
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const rows = applied ?? plan ?? []

  const actionable = useMemo(
    () =>
      rows.filter((r) => r.outcome === "approved" || r.outcome === "rejected"),
    [rows]
  )
  const skipped = useMemo(
    () => rows.filter((r) => r.outcome === "skipped"),
    [rows]
  )
  const failed = useMemo(() => rows.filter((r) => r.outcome === "failed"), [rows])

  /** Designs that will be listed for the first time by THIS batch. */
  const toCreate = useMemo(
    () =>
      new Set(
        rows
          .filter((r) => r.outcome === "approved" && !r.product_existed)
          .map((r) => r.design_id)
      ).size,
    [rows]
  )
  const alreadyListed = useMemo(
    () =>
      new Set(
        rows
          .filter((r) => r.outcome === "approved" && r.product_existed)
          .map((r) => r.design_id)
      ).size,
    [rows]
  )

  const needsReason = decision === "reject" && !reason.trim()

  const confirm = async () => {
    if (!decision) return
    try {
      const res = await review({
        run_ids: runIds,
        decision,
        ...(decision === "reject" ? { reason: reason.trim() } : {}),
      })
      const result = res.run_approvals
      setApplied(result.runs)
      onApplied()

      const done =
        decision === "approve" ? result.approved.length : result.rejected.length

      /**
       * 🔑 The counts, out loud. A partial batch is a real outcome (#1263) and
       * a toast that says "Done" over three failures is how it goes unnoticed.
       */
      const parts = [`${done} run${done === 1 ? "" : "s"} ${decision}d`]
      if (decision === "approve") {
        parts.push(
          `${result.created_product_ids.length} product${
            result.created_product_ids.length === 1 ? "" : "s"
          } created`
        )
      }
      if (result.skipped.length) parts.push(`${result.skipped.length} skipped`)
      if (result.failed.length) parts.push(`${result.failed.length} failed`)

      if (result.failed.length) {
        toast.warning(parts.join(", "))
      } else {
        toast.success(parts.join(", "))
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not apply the decision.")
    }
  }

  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <Drawer.Content className="flex flex-col">
        <Drawer.Header>
          <Drawer.Title asChild>
            <Heading level="h2">
              {decision === "reject" ? "Reject output" : "Approve output"}
            </Heading>
          </Drawer.Title>
        </Drawer.Header>

        <Drawer.Body className="flex-1 overflow-y-auto">
          <Text size="small" className="text-ui-fg-subtle mb-4">
            {decision === "reject"
              ? "Nothing is created. The runs stay completed — the work was done and is still billable — and they leave this queue with the reason recorded."
              : "A product is created once per DESIGN, however many of its runs you selected. A design that already has a product is not listed again."}
          </Text>

          {isPending && !rows.length ? (
            <Text size="small" className="text-ui-fg-subtle">
              Working out what this would do…
            </Text>
          ) : null}

          {rows.length ? (
            <>
              {!applied && (
                <Text size="small" weight="plus" className="mb-1">
                  Preview — nothing has been created yet.
                </Text>
              )}
              <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1">
                <Text size="small" weight="plus">
                  {actionable.length} of {batchSize} runs
                </Text>
                {decision === "approve" && (
                  <>
                    <Text size="small" className="text-ui-fg-subtle">
                      {toCreate} product{toCreate === 1 ? "" : "s"} to create
                    </Text>
                    {alreadyListed > 0 && (
                      <Text size="small" className="text-ui-fg-subtle">
                        {alreadyListed} design
                        {alreadyListed === 1 ? "" : "s"} already listed
                      </Text>
                    )}
                  </>
                )}
                {skipped.length > 0 && (
                  <Text size="small" className="text-ui-fg-subtle">
                    {skipped.length} skipped
                  </Text>
                )}
                {failed.length > 0 && (
                  <Text size="small" className="text-ui-fg-error">
                    {failed.length} failed
                  </Text>
                )}
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Run</Table.HeaderCell>
                      <Table.HeaderCell>Design</Table.HeaderCell>
                      <Table.HeaderCell>Outcome</Table.HeaderCell>
                      <Table.HeaderCell>Notes</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((r) => (
                      <Table.Row key={r.run_id}>
                        <Table.Cell className="font-mono text-ui-fg-subtle">
                          {shortId(r.run_id)}
                        </Table.Cell>
                        <Table.Cell>{r.design_name ?? "—"}</Table.Cell>
                        <Table.Cell>
                          {/*
                            The outcome word alone. "would be approved" wrapped
                            to two lines inside the column and read as a
                            different, longer status — the preview/applied
                            distinction is said once, above the table, where it
                            has room to be said properly.
                          */}
                          <Badge size="2xsmall" color={outcomeColor(r.outcome) as any}>
                            {r.outcome}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="small" className="text-ui-fg-subtle">
                            {r.reason
                              ? r.reason
                              : r.product_existed
                                ? "Already listed — nothing new created"
                                : r.outcome === "approved"
                                  ? `Lists at ${r.listed_price ?? 0} ${(
                                      r.currency_code ?? ""
                                    ).toUpperCase()}`
                                  : "—"}
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            </>
          ) : null}

          {decision === "reject" && !applied && (
            <div className="mt-4">
              <Text size="small" weight="plus" className="mb-1">
                Why is this output being refused?
              </Text>
              <Text size="small" className="text-ui-fg-subtle mb-2">
                Required. It is the only record of why, and the partner who made
                the goods has to be able to be told.
              </Text>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Dye lot off-shade against the approved swatch"
              />
            </div>
          )}
        </Drawer.Body>

        <Drawer.Footer>
          <Button variant="secondary" size="small" onClick={onClose}>
            {applied ? "Close" : "Cancel"}
          </Button>
          {!applied && (
            <Button
              size="small"
              variant={decision === "reject" ? "danger" : "primary"}
              isLoading={isPending}
              disabled={!actionable.length || needsReason}
              onClick={confirm}
            >
              {decision === "reject"
                ? `Reject ${actionable.length}`
                : `Approve ${actionable.length}`}
            </Button>
          )}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
