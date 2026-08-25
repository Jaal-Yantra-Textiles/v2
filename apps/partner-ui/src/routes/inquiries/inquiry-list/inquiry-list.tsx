import { Badge, Button, Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { Link, Outlet } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import {
  PartnerInquiryListRow,
  usePartnerInquiries,
} from "../../../hooks/api/partner-inquiries"

/**
 * Every design someone has asked this partner about (#1531 slice 2).
 *
 * 🔑 An inquiry the partner has not answered is the important row, so it leads
 * with what is still owed rather than with a table of ids. The whole feature
 * exists because these asks used to live in WhatsApp threads and got lost.
 */

const VERDICT_LABEL: Record<string, string> = {
  can_make: "You said: can make",
  cannot_make: "You said: cannot make",
  with_changes: "You said: with changes",
}

const statusOf = (row: PartnerInquiryListRow) => {
  if (row.status === "closed") {
    return { color: "grey" as const, label: "Closed" }
  }
  if (row.response?.submitted_at) {
    return { color: "green" as const, label: "Answered" }
  }
  return { color: "orange" as const, label: "Needs your answer" }
}

const relative = (value?: string | null) => {
  if (!value) return null
  const days = Math.floor(
    (Date.now() - new Date(value).getTime()) / 86_400_000
  )
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  return `${days} days ago`
}

export const InquiryList = () => {
  const { inquiries, isLoading } = usePartnerInquiries()

  // Unanswered first, and inside that the oldest first — the one that has been
  // waiting longest is the one someone is waiting on.
  const ordered = [...inquiries].sort((a, b) => {
    const aOpen = a.status === "open" && !a.response?.submitted_at ? 0 : 1
    const bOpen = b.status === "open" && !b.response?.submitted_at ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    return (
      new Date(a.created_at ?? 0).getTime() -
      new Date(b.created_at ?? 0).getTime()
    )
  })

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">What can you make?</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Designs we are sourcing. Answering one takes a few minutes and means
            we stop asking you the same question next season.
          </Text>
        </div>

        {isLoading && (
          <div className="px-6 py-8">
            <Text size="small" className="text-ui-fg-subtle">
              Loading…
            </Text>
          </div>
        )}

        {!isLoading && !ordered.length && (
          <div className="px-6 py-10 text-center">
            <Text size="small" className="text-ui-fg-subtle">
              Nothing to answer right now. When we are sourcing a design you
              could make, it will appear here.
            </Text>
          </div>
        )}

        {ordered.map((row) => {
          const status = statusOf(row)
          const asked = relative(row.created_at)
          return (
            <div
              key={row.id}
              className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 items-center gap-4">
                {row.design_thumbnail ? (
                  <img
                    src={row.design_thumbnail}
                    alt=""
                    className="size-12 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="bg-ui-bg-subtle size-12 shrink-0 rounded-md" />
                )}
                <div className="min-w-0">
                  <Text weight="plus" className="truncate">
                    {row.title}
                  </Text>
                  <Text size="small" className="text-ui-fg-subtle truncate">
                    {row.design_name ?? row.design_id}
                    {" · "}
                    {row.question_count}{" "}
                    {row.question_count === 1 ? "question" : "questions"}
                    {asked ? ` · asked ${asked}` : ""}
                  </Text>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {row.response?.verdict && (
                  <Badge size="2xsmall">
                    {VERDICT_LABEL[row.response.verdict] ??
                      row.response.verdict}
                  </Badge>
                )}
                <StatusBadge color={status.color}>{status.label}</StatusBadge>
                <Link to={`/inquiries/${row.id}`}>
                  <Button size="small" variant="secondary">
                    {row.status === "closed"
                      ? "View"
                      : row.response?.submitted_at
                        ? "Change my answer"
                        : "Answer"}
                  </Button>
                </Link>
              </div>
            </div>
          )
        })}
      </Container>

      {/* The inquiry itself opens OVER this list (#1543). Nested rather than a
          sibling route so the list stays visible behind the modal — closing it
          returns to exactly the row you came from, which matters when a
          partner has several to work through and is doing it on a phone.

          🔑 It stays a ROUTE, not a piece of list state. The WhatsApp invite
          deeplinks straight to /inquiries/:id (#1531 S3); a modal that only
          existed as a `useState` on this page would 404 that link. */}
      <Outlet />
    </SingleColumnPage>
  )
}
