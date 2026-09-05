import { useNavigate } from "react-router-dom"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"

import { SingleColumnPage } from "../../../../../components/layout/pages"
import {
  useIdExtractionBatches,
  type IdExtractionBatchSummary,
} from "../../../../../hooks/api/id-extraction-batch"

const STATUS: Record<
  IdExtractionBatchSummary["status"],
  { label: string; color: "grey" | "orange" | "green" | "red" }
> = {
  pending_confirmation: { label: "Waiting to start", color: "grey" },
  running: { label: "Reading", color: "orange" },
  completed: { label: "Finished", color: "green" },
  failed: { label: "Failed", color: "red" },
}

const when = (v?: string | null) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—"

/**
 * Every batch of ID cards this partner has sent for reading (#1816).
 *
 * A batch is created by asking the assistant to read a stack of photographs;
 * this is where they are found afterwards, which the notification's deep link
 * has needed since the feature shipped.
 */
export const IdBatchList = () => {
  const navigate = useNavigate()
  const { data, isPending, isError, error } = useIdExtractionBatches({
    limit: 20,
  })

  if (isError) throw error

  const batches = data?.batches ?? []

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading>ID card batches</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Photographs read one at a time in the background. Nobody joins your
            people until you approve the drafts.
          </Text>
        </div>

        {isPending && (
          <div className="px-6 py-8">
            <Text size="small" className="text-ui-fg-subtle">
              Loading…
            </Text>
          </div>
        )}

        {!isPending && !batches.length && (
          <div className="px-6 py-8">
            <Text size="small" className="text-ui-fg-subtle">
              No batches yet. Send a stack of ID photographs to the assistant
              and it will read them here.
            </Text>
            <Button
              size="small"
              variant="secondary"
              className="mt-3"
              onClick={() => navigate("/assistant")}
            >
              Open the assistant
            </Button>
          </div>
        )}

        <div className="divide-y">
          {batches.map((b) => {
            const status = STATUS[b.status] ?? STATUS.running
            const read = (b.completed ?? 0) + (b.approved ?? 0)
            return (
              <button
                key={b.id}
                type="button"
                className="flex w-full flex-col gap-y-1 px-6 py-4 text-left transition-colors hover:bg-ui-bg-base-hover"
                onClick={() =>
                  navigate(`/settings/people/id-batches/${b.id}`)
                }
              >
                <div className="flex flex-wrap items-center gap-x-2">
                  <Text size="small" weight="plus">
                    {b.total ?? 0} photograph{(b.total ?? 0) === 1 ? "" : "s"}
                  </Text>
                  <Badge size="2xsmall" color={status.color}>
                    {status.label}
                  </Badge>
                  {/* Reported whenever it disagrees with the status — a batch
                      that says "finished" with work left is the shape a killed
                      background run leaves behind (#1742). */}
                  {(b.outstanding ?? 0) > 0 && b.status !== "running" && (
                    <Badge size="2xsmall" color="red">
                      {b.outstanding} outstanding
                    </Badge>
                  )}
                </div>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {read} read
                  {b.failed ? ` · ${b.failed} failed` : ""}
                  {b.approved ? ` · ${b.approved} added` : ""}
                  {" · "}
                  {when(b.created_at)}
                </Text>
                {b.notes && (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {b.notes}
                  </Text>
                )}
              </button>
            )
          })}
        </div>
      </Container>
    </SingleColumnPage>
  )
}
