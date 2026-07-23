import {
  Badge,
  Container,
  Heading,
  Skeleton,
  Text,
} from "@medusajs/ui"
import { Link } from "react-router-dom"
import {
  useMyAgreements,
  type AgreementListItem,
} from "../../hooks/api/investments"

const statusColor = (s: AgreementListItem["status"]) =>
  s === "agreed"
    ? "green"
    : s === "disagreed"
    ? "red"
    : s === "viewed"
    ? "blue"
    : "orange"

const statusLabel = (s: AgreementListItem["status"]) =>
  s === "agreed"
    ? "Signed"
    : s === "disagreed"
    ? "Declined"
    : s === "viewed"
    ? "Viewed"
    : s === "expired"
    ? "Expired"
    : "Awaiting signature"

const Row = ({ a }: { a: AgreementListItem }) => (
  <Link
    to={`/agreements/${a.id}`}
    className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-ui-bg-subtle-hover"
  >
    <div className="flex flex-col gap-y-0.5">
      <Text size="small" weight="plus">
        {a.instrument_label || "Subscription agreement"}
      </Text>
      <Text size="xsmall" className="text-ui-fg-subtle">
        {[a.company_name, a.deal_name, a.amount_formatted]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </div>
    <Badge size="2xsmall" color={statusColor(a.status)}>
      {statusLabel(a.status)}
    </Badge>
  </Link>
)

export const Component = () => {
  const { agreements, isPending } = useMyAgreements()

  return (
    <div className="flex flex-col gap-y-3">
      <div>
        <Heading level="h1">Agreements</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Subscription, SAFE and CCPS agreements issued to you — review & sign
        </Text>
      </div>

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Your agreements</Heading>
        </div>
        {isPending ? (
          <div className="flex flex-col gap-y-2 px-6 py-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : agreements.length === 0 ? (
          <div className="px-6 py-5">
            <Text size="small" className="text-ui-fg-subtle">
              No agreements yet. When you commit to a deal, your agreement will
              appear here to review and sign.
            </Text>
          </div>
        ) : (
          <div className="divide-y">
            {agreements.map((a) => (
              <Row key={a.id} a={a} />
            ))}
          </div>
        )}
      </Container>
    </div>
  )
}
