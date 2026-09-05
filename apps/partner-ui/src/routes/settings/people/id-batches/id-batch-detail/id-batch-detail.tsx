import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowPath } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"

import { SingleColumnPage } from "../../../../../components/layout/pages"
import {
  isBatchSettled,
  useApproveIdExtractionBatch,
  useConfirmIdExtractionBatch,
  useIdExtractionBatch,
  useRetryIdExtractionBatch,
  type IdExtractionBatch,
} from "../../../../../hooks/api/id-extraction-batch"
import { extractErrorMessage } from "../../../../../lib/extract-error-message"
import {
  buildApprovePayload,
  isApprovable,
  type BatchEdits,
  type ItemEdits,
} from "../../../../../lib/id-batch-approval"
import { IdBatchItemCard } from "./id-batch-item-card"

/** While the server is still working, ask again. Cheap read, well under the
 *  ~20s pace at which photographs are read. */
const POLL_MS = 6_000

const BATCH_STATUS: Record<
  IdExtractionBatch["status"],
  { label: string; color: "grey" | "orange" | "green" | "red" }
> = {
  pending_confirmation: { label: "Waiting to start", color: "grey" },
  running: { label: "Reading", color: "orange" },
  completed: { label: "Finished", color: "green" },
  failed: { label: "Failed", color: "red" },
}

/**
 * The batch review screen (#1816).
 *
 * The batch notification has always deep-linked somewhere; until now there was
 * no screen at the other end, so the only way to see what ten photographs
 * produced was to ask the assistant. This is that screen: every draft, the
 * reader's own doubts, and the one button that turns a draft into a person.
 *
 * 🔴 Nothing here creates a person on its own. Approval is a separate act
 * because the reader's field assignment varies between runs of the SAME card,
 * and at ten photographs the review is exactly what gets skipped.
 */
export const IdBatchDetail = () => {
  const { id = "" } = useParams()
  const navigate = useNavigate()

  const [edits, setEdits] = useState<BatchEdits>({})
  const [selected, setSelected] = useState<string[]>([])

  const { batch, items, isPending, isError, error } = useIdExtractionBatch(id, {
    /**
     * 🔑 Polling stops on the batch's own settled status, not on a count.
     * A batch whose background loop a deploy killed keeps saying `running`
     * (#1742) — that is what `outstanding` below is for, and it is reported
     * rather than polled at forever.
     */
    refetchInterval: (query) =>
      isBatchSettled(query.state.data?.batch) ? false : POLL_MS,
  })

  const { mutateAsync: confirm, isPending: isConfirming } =
    useConfirmIdExtractionBatch(id)
  const { mutateAsync: retry, isPending: isRetrying } =
    useRetryIdExtractionBatch(id)
  const { mutateAsync: approve, isPending: isApproving } =
    useApproveIdExtractionBatch(id)

  if (isError) throw error

  const rows = items ?? []

  const approvable = useMemo(
    () => rows.filter((i) => isApprovable(i, edits[i.id])),
    [rows, edits]
  )

  /**
   * ⚠️ Selection is intersected with what is still approvable on every render.
   * An item selected while it was a draft can be approved by another tab, or
   * re-read by a retry, between the click and the submit — carrying a stale id
   * into the payload turns a partial success into a confusing "skipped".
   */
  const effectiveSelection = useMemo(() => {
    const usable = new Set(approvable.map((i) => i.id))
    return selected.filter((s) => usable.has(s))
  }, [selected, approvable])

  const handleApprove = async () => {
    const payload = buildApprovePayload(rows, effectiveSelection, edits)
    if (!payload.item_ids.length) return

    try {
      const res = await approve(payload)
      setSelected([])
      if (res.approved > 0) {
        toast.success(res.message, {
          description: res.skipped
            ? `${res.skipped} skipped — the reasons are on each photograph.`
            : undefined,
          action: {
            label: "See people",
            altText: "Open the people list",
            onClick: () => navigate("/settings/people"),
          },
        })
      } else {
        toast.warning(res.message)
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, "Could not add these people."))
    }
  }

  const handleRetry = async (scope: "failed" | "pending") => {
    try {
      const res = await retry({ scope })
      if (res.nothing_to_do) {
        toast.info(res.message)
      } else {
        toast.success(res.message)
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, "Could not restart the reading."))
    }
  }

  const handleConfirm = async () => {
    try {
      const res = await confirm()
      toast.success(res.message)
    } catch (e) {
      toast.error(extractErrorMessage(e, "Could not start the reading."))
    }
  }

  if (isPending && !batch) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }}>
        <Container className="p-6">
          <Text size="small" className="text-ui-fg-subtle">
            Loading this batch…
          </Text>
        </Container>
      </SingleColumnPage>
    )
  }

  if (!batch) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }}>
        <Container className="p-6">
          <Heading level="h2">Batch not found</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            It may belong to another partner, or have been removed.
          </Text>
          <Button
            className="mt-4"
            size="small"
            variant="secondary"
            onClick={() => navigate("/settings/people/id-batches")}
          >
            All batches
          </Button>
        </Container>
      </SingleColumnPage>
    )
  }

  const status = BATCH_STATUS[batch.status] ?? BATCH_STATUS.running
  const read = batch.completed + batch.approved
  /**
   * 🔴 `outstanding` disagrees with `status` exactly when a deploy killed the
   * in-process loop while the row still says `running`. Saying so, with the
   * button that fixes it, is the whole reason it is on the response.
   */
  const stalled = isBatchSettled(batch) && batch.outstanding > 0

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <Container className="divide-y p-0">
        <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-x-2">
              <Heading>ID cards</Heading>
              <Badge size="2xsmall" color={status.color}>
                {status.label}
              </Badge>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {read} of {batch.total} read
              {batch.failed ? ` · ${batch.failed} failed` : ""}
              {batch.approved ? ` · ${batch.approved} added to people` : ""}
              {batch.status === "running" && batch.pending
                ? ` · one photograph roughly every ${Math.round(batch.interval_ms / 1000)}s`
                : ""}
            </Text>
            {batch.notes && (
              <Text size="xsmall" className="text-ui-fg-muted mt-1">
                {batch.notes}
              </Text>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {batch.status === "pending_confirmation" && (
              <Button size="small" isLoading={isConfirming} onClick={handleConfirm}>
                Start reading
              </Button>
            )}
            {batch.failed > 0 && (
              <Button
                size="small"
                variant="secondary"
                isLoading={isRetrying}
                onClick={() => handleRetry("failed")}
              >
                <ArrowPath className="mr-1" />
                Re-read {batch.failed} failed
              </Button>
            )}
            <Button
              size="small"
              isLoading={isApproving}
              disabled={effectiveSelection.length === 0}
              onClick={handleApprove}
            >
              {effectiveSelection.length
                ? `Add ${effectiveSelection.length} to people`
                : "Add to people"}
            </Button>
          </div>
        </div>

        {stalled && (
          <div className="bg-ui-bg-subtle px-6 py-3">
            <Text size="small">
              This batch says it finished, but {batch.outstanding} photograph(s)
              were never read — the background run was interrupted.
            </Text>
            <Button
              size="small"
              variant="secondary"
              className="mt-2"
              isLoading={isRetrying}
              onClick={() => handleRetry("pending")}
            >
              <ArrowPath className="mr-1" />
              Finish the outstanding {batch.outstanding}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
          <Text size="small" className="text-ui-fg-subtle">
            Nobody is added to your people until you approve them here. Correct
            anything the reader got wrong first — the edit is what gets saved.
          </Text>
          <div className="flex items-center gap-x-2">
            <Button
              size="small"
              variant="transparent"
              disabled={!approvable.length}
              onClick={() => setSelected(approvable.map((i) => i.id))}
            >
              Select all {approvable.length ? `(${approvable.length})` : ""}
            </Button>
            <Button
              size="small"
              variant="transparent"
              disabled={!effectiveSelection.length}
              onClick={() => setSelected([])}
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="divide-y">
          {rows.map((item) => (
            <IdBatchItemCard
              key={item.id}
              item={item}
              edits={edits[item.id]}
              selected={effectiveSelection.includes(item.id)}
              onSelect={(isSelected) =>
                setSelected((prev) =>
                  isSelected
                    ? [...new Set([...prev, item.id])]
                    : prev.filter((s) => s !== item.id)
                )
              }
              onEdit={(next: ItemEdits) =>
                setEdits((prev) => ({ ...prev, [item.id]: next }))
              }
              onRetry={
                item.status === "failed" ? () => handleRetry("failed") : undefined
              }
              isRetrying={isRetrying}
            />
          ))}
          {!rows.length && (
            <div className="px-6 py-8">
              <Text size="small" className="text-ui-fg-subtle">
                This batch has no photographs in it.
              </Text>
            </div>
          )}
        </div>
      </Container>
    </SingleColumnPage>
  )
}
