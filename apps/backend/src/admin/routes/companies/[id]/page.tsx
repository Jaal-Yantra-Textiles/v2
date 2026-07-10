import {
  Badge,
  Button,
  Container,
  DataTable,
  Heading,
  Skeleton,
  Text,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { UIMatch, useParams, Link, Outlet } from "react-router-dom"
import { CheckCircleSolid, FlagMini, Plus } from "@medusajs/icons"
import {
  PIPELINE_STAGES,
  useCompany,
  useCompanyInvestors,
  useUpdatePipelineStage,
  type CompanyInvestor,
} from "../../../hooks/api/companies-admin"
import { ActionMenu } from "../../../components/common/action-menu"
import { CapTableSection } from "../../../components/companies/cap-table-section"
import { FinancialsSection } from "../../../components/companies/financials-section"
import { ComplianceSection } from "../../../components/companies/compliance-section"

const StageActions = ({
  companyId,
  investor,
}: {
  companyId: string
  investor: CompanyInvestor
}) => {
  const { mutate } = useUpdatePipelineStage(companyId, {
    onSuccess: () => toast.success("Pipeline stage updated"),
    onError: (e) => toast.error(e?.message || "Failed to update stage"),
  })
  if (!investor.pipeline_id) return null
  return (
    <ActionMenu
      groups={[
        {
          actions: [
            {
              icon: <CheckCircleSolid />,
              label: "Mark onboarded",
              disabled: investor.pipeline_stage === "onboarded",
              onClick: () =>
                mutate({ pipelineId: investor.pipeline_id!, stage: "onboarded" }),
            },
          ],
        },
        {
          actions: PIPELINE_STAGES.map((stage) => ({
            icon: <FlagMini />,
            label: `Set stage: ${stage.replace(/_/g, " ")}`,
            disabled: investor.pipeline_stage === stage,
            onClick: () => mutate({ pipelineId: investor.pipeline_id!, stage }),
          })),
        },
      ]}
    />
  )
}

const CompanyDetailPage = () => {
  const { id } = useParams()
  const { company, isPending: companyLoading } = useCompany(id!)
  const { investors = [] } = useCompanyInvestors(id!)
  const investorsTable = useDataTable({
    data: investors,
    columns: [
      { header: "Name", accessorKey: "name" },
      {
        header: "Type",
        accessorKey: "investor_type",
        cell: ({ row }) => <Badge>{row.original.investor_type}</Badge>,
      },
      { header: "Email", accessorKey: "email" },
      {
        header: "Stage",
        accessorKey: "pipeline_stage",
        cell: ({ row }) => (
          <Badge color={row.original.pipeline_stage === "onboarded" ? "green" : "grey"}>
            {(row.original.pipeline_stage ?? "lead").replace(/_/g, " ")}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end">
            <StageActions companyId={id!} investor={row.original} />
          </div>
        ),
      },
    ],
  })

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading>{company?.name}</Heading>
        </div>
        <div className="px-6 py-4">
          {companyLoading ? (
            <div className="flex flex-col gap-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-y-3">
              <div className="flex items-center gap-x-2">
                <Text weight="plus">Email</Text>
                <Text className="text-ui-fg-subtle">{company?.email || "—"}</Text>
              </div>
              <div className="flex items-center gap-x-2">
                <Text weight="plus">Industry</Text>
                <Text className="text-ui-fg-subtle">{company?.industry || "—"}</Text>
              </div>
              <div className="flex items-center gap-x-2">
                <Text weight="plus">Legal name</Text>
                <Text className="text-ui-fg-subtle">{company?.legal_name || "—"}</Text>
              </div>
            </div>
          )}
        </div>
      </Container>

      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">Investors</Heading>
          <ActionMenu
            groups={[
              {
                actions: [
                  { icon: <Plus />, label: "Invite investor", to: "invite-investor" },
                ],
              },
            ]}
          />
        </div>
        <DataTable instance={investorsTable}>
          <DataTable.Table />
        </DataTable>
      </Container>

      <CapTableSection companyId={id!} />
      <FinancialsSection companyId={id!} />
      <ComplianceSection companyId={id!} company={company} />

      {/* Route-modal outlet: @add-share-class, @add-round, @record-payment,
          @add-document, @edit-details, @create-cap-table, @participations,
          @invite-investor render here as drawers / focus modals. */}
      <Outlet />
    </div>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return `${id}`
  },
}

export default CompanyDetailPage
