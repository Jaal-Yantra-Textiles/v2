import { Badge, Button, Container, Heading, Table, Text, Tooltip } from "@medusajs/ui"
import { Link, useNavigate } from "react-router-dom"

import {
  usePartnersOwed,
  type PartnerOwedRow,
} from "../../../hooks/api/payment-submissions"

const inr = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

/** "12 days" / "3 months" since the oldest unpaid thing. */
const waited = (iso: string | null): string => {
  if (!iso) return "—"
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return "today"
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`
  return `${Math.floor(days / 30)} months`
}

/** A money cell with the count of things behind it underneath. */
const Amount = ({ value, note }: { value: number; note?: string }) =>
  value > 0 ? (
    <div className="flex flex-col">
      <span>{inr(value)}</span>
      {note && <span className="text-ui-fg-muted text-xs">{note}</span>}
    </div>
  ) : (
    <span className="text-ui-fg-muted">—</span>
  )

/** Things a human must look at before paying. Never inside the total. */
const Flags = ({ row }: { row: PartnerOwedRow }) => (
  <div className="flex flex-wrap gap-1">
    {row.check_first_count > 0 && (
      <Tooltip content="An older payout for these designs never said which runs it paid for. These may already be paid. Check before billing them.">
        <Badge size="2xsmall" color="orange">
          {row.check_first_count} to check ({inr(row.check_first_amount)})
        </Badge>
      </Tooltip>
    )}
    {row.needs_price_count > 0 && (
      <Tooltip content="Finished work with no agreed price. Type the price on the payout.">
        <Badge size="2xsmall" color="grey">
          {row.needs_price_count} need a price
        </Badge>
      </Tooltip>
    )}
    {row.goods_possibly_prepaid_count > 0 && (
      <Tooltip content="Money already recorded against this order covers what is offered. It may be prepaid.">
        <Badge size="2xsmall" color="orange">
          {row.goods_possibly_prepaid_count} maybe prepaid
        </Badge>
      </Tooltip>
    )}
    {row.recorded_against_open > 0 && (
      <Tooltip content="Payments already recorded against what an unpaid payout bills. Link them to the payout if they settle it.">
        <Badge size="2xsmall" color="orange">
          {inr(row.recorded_against_open)} already recorded
        </Badge>
      </Tooltip>
    )}
    {row.mixed_currency && (
      <Badge size="2xsmall" color="red">
        not all INR
      </Badge>
    )}
  </div>
)

/**
 * "Who to pay" (#2480): every partner we owe, most owed first.
 *
 * The numbers are the payout screens' own (see the route), so "Create payout"
 * opens on a screen that offers exactly the "Not billed yet" figure here.
 */
export const WhoToPayTab = () => {
  const navigate = useNavigate()
  const { partners_owed, total_owed, settled_count, failed, isPending, isError, error } =
    usePartnersOwed()

  return (
    <div className="flex flex-col gap-y-4 px-6 pb-6">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Who to pay</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Partners we owe, most first. Runs to check and work with no price are
              shown but not counted.
            </Text>
          </div>
          {!isPending && !isError && (
            <div className="text-right">
              <Text size="small" className="text-ui-fg-subtle">
                Owed in total
              </Text>
              <Text weight="plus">{inr(total_owed)}</Text>
            </div>
          )}
        </div>

        {isPending ? (
          <div className="px-6 py-8">
            <Text size="small" className="text-ui-fg-subtle">
              Reading every partner's runs, goods and payouts…
            </Text>
          </div>
        ) : isError ? (
          <div className="px-6 py-8">
            <Text size="small" className="text-ui-fg-error">
              Could not load: {(error as any)?.message || "unknown error"}
            </Text>
          </div>
        ) : (
          <>
            {failed.length > 0 && (
              <div className="bg-ui-bg-subtle px-6 py-3">
                <Text size="small" className="text-ui-fg-error">
                  Could not read {failed.length} partner
                  {failed.length === 1 ? "" : "s"}, so they are missing from this
                  list (not owed nothing):{" "}
                  {failed.map((f) => f.partner_name || f.partner_id).join(", ")}
                </Text>
              </div>
            )}

            {partners_owed.length === 0 ? (
              <div className="px-6 py-8">
                <Text size="small" className="text-ui-fg-subtle">
                  Nobody is owed anything right now.
                </Text>
              </div>
            ) : (
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Partner</Table.HeaderCell>
                    <Table.HeaderCell className="text-right">Owed</Table.HeaderCell>
                    <Table.HeaderCell>Not billed yet</Table.HeaderCell>
                    <Table.HeaderCell>Billed, not paid</Table.HeaderCell>
                    <Table.HeaderCell>Waiting</Table.HeaderCell>
                    <Table.HeaderCell>Check</Table.HeaderCell>
                    <Table.HeaderCell />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {partners_owed.map((row) => {
                    const unbilled = row.unbilled_work + row.unbilled_goods
                    const parts = [
                      row.unbilled_work_count
                        ? `${row.unbilled_work_count} run${row.unbilled_work_count === 1 ? "" : "s"}`
                        : null,
                      row.unbilled_goods_count
                        ? `${row.unbilled_goods_count} goods order${row.unbilled_goods_count === 1 ? "" : "s"}`
                        : null,
                    ].filter(Boolean)
                    return (
                      <Table.Row key={row.partner_id}>
                        <Table.Cell>
                          <Link
                            to={`/partners/${row.partner_id}`}
                            className="text-ui-fg-interactive hover:underline"
                          >
                            {row.partner_name || row.partner_id}
                          </Link>
                        </Table.Cell>
                        <Table.Cell className="text-right font-medium">
                          {row.total_owed > 0 ? inr(row.total_owed) : "—"}
                        </Table.Cell>
                        <Table.Cell>
                          <Amount value={unbilled} note={parts.join(", ")} />
                        </Table.Cell>
                        <Table.Cell>
                          <Amount
                            value={row.billed_unpaid}
                            note={
                              row.unpaid_payout_count
                                ? `${row.unpaid_payout_count} payout${row.unpaid_payout_count === 1 ? "" : "s"}`
                                : undefined
                            }
                          />
                        </Table.Cell>
                        <Table.Cell>{waited(row.oldest_unpaid_at)}</Table.Cell>
                        <Table.Cell>
                          <Flags row={row} />
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          {unbilled > 0 || row.needs_price_count > 0 || row.check_first_count > 0 ? (
                            <Button
                              size="small"
                              variant="secondary"
                              onClick={() =>
                                navigate(
                                  `/payment-submissions/create?partner_id=${encodeURIComponent(row.partner_id)}`
                                )
                              }
                            >
                              Create payout
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              variant="transparent"
                              onClick={() => navigate(`/partners/${row.partner_id}`)}
                            >
                              Open ledger
                            </Button>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    )
                  })}
                </Table.Body>
              </Table>
            )}

            {settled_count > 0 && (
              <div className="px-6 py-3">
                <Text size="small" className="text-ui-fg-muted">
                  {settled_count} other partner{settled_count === 1 ? "" : "s"} owed
                  nothing.
                </Text>
              </div>
            )}
          </>
        )}
      </Container>
    </div>
  )
}
