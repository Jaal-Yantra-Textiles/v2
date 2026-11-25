import { ArrowPath, ChatBubbleLeftRight, CurrencyDollar, Link as LinkIcon, PencilSquare } from "@medusajs/icons"
import {
  Badge,
  Container,
  DataTable,
  Heading,
  StatusBadge,
  Text,
  createDataTableColumnHelper,
  useDataTable,
} from "@medusajs/ui"
import { useMemo, useState } from "react"
import { UIMatch, useParams } from "react-router-dom"

import { ActionMenu } from "../../../../components/common/action-menu"
import { TwoColumnPage } from "../../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../../components/table/skeleton"
import { AdminBrief, useQuoteBrief } from "../../../../hooks/api/quote-briefs"
import { BRIEF_STATUS } from "../page"
import { ChoiceRateDrawer, ChoiceTarget, IssueLinkDrawer, PostUpdateDrawer, StatusDrawer } from "./brief-drawers"

/**
 * One brief (#2608), laid out like the quote draft page: a read-only record
 * in two columns, each card with its own `…` menu, every edit in a drawer.
 */

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="grid grid-cols-2 items-center px-6 py-4">
    <Text size="small" weight="plus" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text size="small">{value || "-"}</Text>
  </div>
)

const money = (cur: string, low: number, high: number) =>
  `${String(cur).toUpperCase()} ${low}${high !== low ? `–${high}` : ""}`

const SectionHeader = ({ title, subtitle, menu }: { title: string; subtitle?: string; menu?: React.ReactNode }) => (
  <div className="flex items-center justify-between px-6 py-4">
    <div>
      <Heading level="h2">{title}</Heading>
      {subtitle && (
        <Text size="small" className="text-ui-fg-subtle">
          {subtitle}
        </Text>
      )}
    </div>
    {menu}
  </div>
)

const BriefPage = () => {
  const { id } = useParams()
  const { data, isLoading, isError } = useQuoteBrief(id!)
  const [drawer, setDrawer] = useState<null | "link" | "status" | "update">(null)
  const [rateTarget, setRateTarget] = useState<ChoiceTarget | null>(null)
  const [link, setLink] = useState<string | null>(null)

  if (isLoading) return <TwoColumnPageSkeleton mainSections={3} sidebarSections={2} />
  if (isError || !data?.brief) {
    return (
      <Container>
        <Text size="small" className="text-ui-fg-subtle">
          This brief could not be loaded.
        </Text>
      </Container>
    )
  }
  const b = data.brief
  const st = BRIEF_STATUS[b.status]
  const ratesLocked = b.status === "quoted" || b.status === "closed"

  return (
    <>
      <TwoColumnPage widgets={{ before: [], after: [], sideBefore: [], sideAfter: [] }}>
        <TwoColumnPage.Main>
          {/* ---- identity ---- */}
          <Container className="flex items-start justify-between p-6">
            <div>
              <div className="flex items-center gap-x-2">
                <Heading>{b.title}</Heading>
                <StatusBadge color={st?.color ?? "grey"}>{st?.label ?? b.status}</StatusBadge>
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                Lead: {b.lead?.name ?? b.partner_id} · {b.view_count ?? 0} views ·{" "}
                {b.submitted_at ? `sent by the buyer ${new Date(b.submitted_at).toLocaleString()}` : "not sent by the buyer yet"}
              </Text>
            </div>
            <ActionMenu
              groups={[
                {
                  actions: [
                    {
                      icon: b.has_link ? <ArrowPath /> : <LinkIcon />,
                      label: b.has_link ? "Issue a new link" : "Open and get the link",
                      onClick: () => setDrawer("link"),
                    },
                    { icon: <PencilSquare />, label: "Change status", onClick: () => setDrawer("status") },
                  ],
                },
              ]}
            />
          </Container>

          {/* The raw token comes back once; this card holds the only copy. */}
          {link && (
            <Container className="flex flex-col gap-y-1 border-ui-border-interactive p-6">
              <Text size="small" weight="plus">
                Buyer's link (shown once, copy it now)
              </Text>
              <Text size="small" className="break-all font-mono">
                {link}
              </Text>
            </Container>
          )}

          {/* ---- one card per style: a DataTable of step × workshop ---- */}
          {b.options.map((o: any) => (
            <OptionTable key={o.id} option={o} ratesLocked={ratesLocked} onEditRate={setRateTarget} />
          ))}

          {/* ---- her answers ---- */}
          <Container className="divide-y p-0">
            <SectionHeader title="Her answers" />
            {b.questions.map((q: any) => (
              <Row
                key={q.id}
                label={q.label}
                value={
                  q.answer == null
                    ? null
                    : q.kind === "file"
                      ? (q.answer as any[]).map((f) => (
                          <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="text-ui-fg-interactive mr-2 underline">
                            {f.name}
                          </a>
                        ))
                      : Array.isArray(q.answer)
                        ? q.answer.join(", ")
                        : String(q.answer)
                }
              />
            ))}
          </Container>
        </TwoColumnPage.Main>

        <TwoColumnPage.Sidebar>
          <BuyerCard brief={b} />

          {/* ---- updates on her page ---- */}
          <Container className="divide-y p-0">
            <SectionHeader
              title="Updates"
              subtitle="Shown on her page"
              menu={
                <ActionMenu
                  groups={[
                    { actions: [{ icon: <ChatBubbleLeftRight />, label: "Post an update", onClick: () => setDrawer("update") }] },
                  ]}
                />
              }
            />
            {b.updates.length ? (
              b.updates.map((u: any) => (
                <div key={u.id} className="flex flex-col px-6 py-3">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {new Date(u.created_at).toLocaleString()} · {u.kind}
                  </Text>
                  <Text size="small">{u.message}</Text>
                </div>
              ))
            ) : (
              <div className="px-6 py-4">
                <Text size="small" className="text-ui-fg-subtle">
                  Nothing posted yet.
                </Text>
              </div>
            )}
          </Container>
        </TwoColumnPage.Sidebar>
      </TwoColumnPage>

      <ChoiceRateDrawer briefId={b.id} target={rateTarget} onClose={() => setRateTarget(null)} />
      <IssueLinkDrawer brief={b} open={drawer === "link"} onClose={() => setDrawer(null)} onIssued={setLink} />
      <StatusDrawer brief={b} open={drawer === "status"} onClose={() => setDrawer(null)} />
      <PostUpdateDrawer briefId={b.id} open={drawer === "update"} onClose={() => setDrawer(null)} />
    </>
  )
}

/** One row per workshop per step; a step with no workshop is one "exploring" row. */
type WorkshopRow = {
  id: string
  step: any
  choice: any | null
}

const rowHelper = createDataTableColumnHelper<WorkshopRow>()

const OptionTable = ({
  option: o,
  ratesLocked,
  onEditRate,
}: {
  option: any
  ratesLocked: boolean
  onEditRate: (t: ChoiceTarget) => void
}) => {
  const rows = useMemo<WorkshopRow[]>(
    () =>
      o.steps.flatMap((s: any) =>
        s.choices.length ? s.choices.map((c: any) => ({ id: c.id, step: s, choice: c })) : [{ id: s.id, step: s, choice: null }]
      ),
    [o]
  )

  const columns = useMemo(
    () => [
      rowHelper.display({
        id: "step",
        header: "Step",
        cell: ({ row }) => (
          <Text size="small" weight="plus">
            {row.original.step.label}
          </Text>
        ),
      }),
      rowHelper.display({
        id: "workshop",
        header: "Workshop",
        cell: ({ row }) => {
          const { step, choice } = row.original
          if (!choice) {
            return (
              <Text size="small" className="text-ui-fg-muted">
                Exploring partners
              </Text>
            )
          }
          return (
            <div className="flex items-center gap-x-2">
              <Text size="small">{choice.partner.name}</Text>
              {choice.id === step.selected_choice_id && (
                <Badge size="2xsmall" color="blue">
                  Her pick
                </Badge>
              )}
            </div>
          )
        },
      }),
      rowHelper.display({
        id: "rate",
        header: "Per piece",
        cell: ({ row }) => {
          const c = row.original.choice
          if (!c) return <Text size="small" className="text-ui-fg-muted">-</Text>
          if (!c.estimate) {
            return (
              <Badge size="2xsmall" color="orange">
                Needs a rate
              </Badge>
            )
          }
          return (
            <Text size="small">
              {money(c.estimate.currency_code, c.estimate.low, c.estimate.high)}
              {c.estimate.rate_confirmed ? "" : " (unconfirmed)"}
              {c.estimate.stale ? " · stale" : ""}
            </Text>
          )
        },
      }),
      rowHelper.display({
        id: "actions",
        cell: ({ row }) => {
          const { step, choice } = row.original
          if (!choice) return null
          return (
            <div className="flex justify-end">
              <ActionMenu
                groups={[
                  {
                    actions: [
                      {
                        icon: <CurrencyDollar />,
                        label: choice.rate_id ? "Change rate" : "Attach rate",
                        disabled: ratesLocked,
                        disabledTooltip: "This brief is quoted or closed; its rates no longer change.",
                        onClick: () => onEditRate({ choice, stepLabel: step.label, technique: step.technique }),
                      },
                    ],
                  },
                ]}
              />
            </div>
          )
        },
      }),
    ],
    [ratesLocked, onEditRate]
  )

  const table = useDataTable({ columns, data: rows, getRowId: (r) => r.id, rowCount: rows.length })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-x-2">
              <Heading level="h2">{o.title}</Heading>
              {o.buyer_selected && (
                <Badge size="2xsmall" color="green">
                  Buyer's pick
                </Badge>
              )}
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {o.estimate?.per_piece_high > 0
                ? `Estimate ${money(o.estimate.currency_code, o.estimate.per_piece_low, o.estimate.per_piece_high)} / piece${
                    o.estimate.complete ? "" : ` so far (to confirm: ${o.estimate.pending_steps.join(", ")})`
                  }`
                : "No estimate yet"}
            </Text>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table emptyState={{ empty: { heading: "No steps" } }} />
      </DataTable>
    </Container>
  )
}

const BuyerCard = ({ brief: b }: { brief: AdminBrief }) => (
  <Container className="divide-y p-0">
    <SectionHeader title="Buyer" />
    <Row label="Contact" value={b.recipient_name} />
    <Row label="Company" value={b.recipient_company} />
    <Row label="Email" value={b.buyer_email} />
    <Row label="Ships to" value={String(b.destination_country_code || "").toUpperCase()} />
    <Row label="Samples" value={b.sample_quantity ? `${b.sample_quantity} pcs${b.sample_days ? ` in ${b.sample_days} days` : ""}` : null} />
    <Row label="Link" value={b.has_link ? `Issued${b.expires_at ? `, expires ${new Date(b.expires_at).toLocaleDateString()}` : ""}` : "Not issued"} />
    <Row label="CRM" value={b.crm_opportunity_id ? <Badge size="2xsmall" color="green">{b.crm_opportunity_id}</Badge> : null} />
  </Container>
)

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => match.params.id ?? "Brief",
}

export default BriefPage
