/**
 * Customer Segment Detail Page
 * View segment details, criteria rules, members, and manage segment
 */

import {
  Container,
  Heading,
  Text,
  Badge,
  Button,
  toast,
  usePrompt,
  StatusBadge,
  DataTable,
  createDataTableColumnHelper,
  useDataTable,
  DataTablePaginationState,
} from "@medusajs/ui"
import { useParams, useNavigate, UIMatch } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Trash, ArrowPath, Users } from "@medusajs/icons"
import { TwoColumnPage } from "../../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../../components/table/skeleton"
import { ActionMenu } from "../../../../components/common/action-menu"
import { sdk } from "../../../../lib/config"

// Types
interface Segment {
  id: string
  name: string
  description: string | null
  segment_type: string
  criteria: {
    rules: Array<{ field: string; operator: string; value: any }>
    logic: "AND" | "OR"
  }
  member_count: number
  customer_count: number
  last_calculated_at: string | null
  is_active: boolean
  auto_update: boolean
  color: string | null
  created_at: string
  updated_at: string
}

interface SegmentMember {
  id: string
  person_id: string
  added_at: string
  added_reason: string | null
  person: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    phone: string | null
  } | null
}

const OPERATOR_LABELS: Record<string, string> = {
  ">=": "Greater than or equal",
  "<=": "Less than or equal",
  ">": "Greater than",
  "<": "Less than",
  "==": "Equals",
  "!=": "Not equals",
  contains: "Contains",
  not_contains: "Does not contain",
}

const SEGMENT_TYPE_COLORS: Record<string, "green" | "blue" | "orange" | "purple" | "grey"> = {
  behavioral: "blue",
  demographic: "green",
  rfm: "purple",
  custom: "grey",
}

// --- Section Components ---

const SegmentGeneralSection = ({
  segment,
  onDelete,
  onRebuild,
  isRebuilding,
}: {
  segment: Segment
  onDelete: () => void
  onRebuild: () => void
  isRebuilding: boolean
}) => {
  const prompt = usePrompt()

  const handleDelete = async () => {
    const confirmed = await prompt({
      title: "Delete Segment",
      description:
        "Are you sure you want to delete this segment? All members will be removed. This cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (confirmed) {
      onDelete()
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Heading>{segment.name}</Heading>
            <Badge
              color={SEGMENT_TYPE_COLORS[segment.segment_type] || "grey"}
              size="small"
            >
              {segment.segment_type}
            </Badge>
            <StatusBadge color={segment.is_active ? "green" : "grey"}>
              {segment.is_active ? "Active" : "Inactive"}
            </StatusBadge>
          </div>
          {segment.description && (
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {segment.description}
            </Text>
          )}
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Rebuild Segment",
                  icon: <ArrowPath />,
                  onClick: onRebuild,
                  disabled: isRebuilding,
                },
              ],
            },
            {
              actions: [
                {
                  label: "Delete",
                  icon: <Trash />,
                  onClick: handleDelete,
                },
              ],
            },
          ]}
        />
      </div>

      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Type
        </Text>
        <Text size="small" leading="compact" className="capitalize">
          {segment.segment_type}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Members
        </Text>
        <div className="flex items-center gap-1">
          <Users className="text-ui-fg-muted" />
          <Text size="small" leading="compact">
            {(segment.member_count || segment.customer_count || 0).toLocaleString()}
          </Text>
        </div>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Dynamic Updates
        </Text>
        <Badge color={segment.auto_update ? "green" : "grey"} size="xsmall">
          {segment.auto_update ? "Enabled" : "Disabled"}
        </Badge>
      </div>
      {segment.last_calculated_at && (
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            Last Rebuilt
          </Text>
          <Text size="small" leading="compact">
            {new Date(segment.last_calculated_at).toLocaleString()}
          </Text>
        </div>
      )}
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Created
        </Text>
        <Text size="small" leading="compact">
          {new Date(segment.created_at).toLocaleDateString()}
        </Text>
      </div>
    </Container>
  )
}

const SegmentCriteriaSection = ({ segment }: { segment: Segment }) => {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Segment Criteria</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Logic: <Badge color="grey" size="xsmall">{segment.criteria?.logic || "AND"}</Badge>
          </Text>
        </div>
      </div>

      {!segment.criteria?.rules?.length ? (
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-subtle">No rules defined</Text>
        </div>
      ) : (
        <div className="px-6 py-4 space-y-2">
          {segment.criteria.rules.map((rule, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-3 bg-ui-bg-subtle rounded"
            >
              <Badge color="grey" size="small">
                {rule.field}
              </Badge>
              <Text size="small" className="text-ui-fg-muted">
                {OPERATOR_LABELS[rule.operator] || rule.operator}
              </Text>
              <Badge color="blue" size="small">
                {String(rule.value)}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Container>
  )
}

const SegmentMembersSection = ({ segmentId }: { segmentId: string }) => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["ad-planning", "segment", segmentId, "members", pagination],
    queryFn: async () => {
      const offset = pagination.pageIndex * pagination.pageSize
      const res = await sdk.client.fetch<any>(
        `/admin/ad-planning/segments/${segmentId}/members?limit=${pagination.pageSize}&offset=${offset}`
      )
      return res
    },
  })

  const columnHelper = createDataTableColumnHelper<SegmentMember>()

  const columns = [
    columnHelper.display({
      id: "email",
      header: "Email",
      cell: ({ row }) => (
        <Text size="small" leading="compact">
          {row.original.person?.email || "—"}
        </Text>
      ),
    }),
    columnHelper.display({
      id: "name",
      header: "Name",
      cell: ({ row }) => {
        const person = row.original.person
        const name = [person?.first_name, person?.last_name]
          .filter(Boolean)
          .join(" ")
        return (
          <Text size="small" leading="compact">
            {name || "—"}
          </Text>
        )
      },
    }),
    columnHelper.display({
      id: "phone",
      header: "Phone",
      cell: ({ row }) => (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {row.original.person?.phone || "—"}
        </Text>
      ),
    }),
    columnHelper.accessor("added_at", {
      header: "Added",
      cell: ({ getValue }) => (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {new Date(getValue()).toLocaleDateString()}
        </Text>
      ),
    }),
  ]

  const table = useDataTable({
    data: membersData?.members || [],
    columns,
    getRowId: (member) => member.id,
    rowCount: membersData?.count || 0,
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
  })

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Members</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {membersData?.count || 0} members in this segment
        </Text>
      </div>
      <DataTable instance={table}>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

const SegmentStatsSidebar = ({
  segment,
  onRebuild,
  isRebuilding,
}: {
  segment: Segment
  onRebuild: () => void
  isRebuilding: boolean
}) => {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Summary</Heading>
      </div>

      <div className="px-6 py-4 space-y-4">
        <div>
          <Text size="xsmall" className="text-ui-fg-muted">
            Total Members
          </Text>
          <Text size="xlarge" weight="plus" className="mt-1">
            {(segment.member_count || segment.customer_count || 0).toLocaleString()}
          </Text>
        </div>

        <div>
          <Text size="xsmall" className="text-ui-fg-muted">
            Status
          </Text>
          <div className="mt-1">
            <StatusBadge color={segment.is_active ? "green" : "grey"}>
              {segment.is_active ? "Active" : "Inactive"}
            </StatusBadge>
          </div>
        </div>

        <div>
          <Text size="xsmall" className="text-ui-fg-muted">
            Criteria Rules
          </Text>
          <Text size="small" weight="plus" className="mt-1">
            {segment.criteria?.rules?.length || 0} rules
          </Text>
        </div>

        <div>
          <Text size="xsmall" className="text-ui-fg-muted">
            Last Rebuilt
          </Text>
          <Text size="small" className="mt-1">
            {segment.last_calculated_at
              ? new Date(segment.last_calculated_at).toLocaleString()
              : "Never"}
          </Text>
        </div>
      </div>

      <div className="px-6 py-4">
        <Button
          variant="secondary"
          className="w-full"
          onClick={onRebuild}
          isLoading={isRebuilding}
        >
          <ArrowPath className="mr-2" />
          Rebuild Segment
        </Button>
      </div>
    </Container>
  )
}

// --- Main Page Component ---

const SegmentDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: segmentData, isLoading } = useQuery({
    queryKey: ["ad-planning", "segment", id],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        `/admin/ad-planning/segments/${id}`
      )
      return res
    },
    enabled: !!id,
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return await sdk.client.fetch<any>(
        `/admin/ad-planning/segments/${id}`,
        { method: "DELETE" }
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad-planning", "segments"] })
      toast.success("Segment deleted")
      navigate("/ad-planning/segments")
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete segment")
    },
  })

  const rebuildMutation = useMutation({
    mutationFn: async () => {
      return await sdk.client.fetch<any>(
        `/admin/ad-planning/segments/${id}/build`,
        { method: "POST" }
      )
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["ad-planning", "segment", id],
      })
      queryClient.invalidateQueries({
        queryKey: ["ad-planning", "segment", id, "members"],
      })
      toast.success(result.message || "Segment rebuilt successfully")
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to rebuild segment")
    },
  })

  if (isLoading) {
    return <TwoColumnPageSkeleton mainSections={3} sidebarSections={1} showJSON />
  }

  const segment = segmentData?.segment

  if (!segment) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-error">Segment not found</Text>
      </Container>
    )
  }

  return (
    <TwoColumnPage showJSON data={segment}>
      <TwoColumnPage.Main>
        <SegmentGeneralSection
          segment={segment}
          onDelete={() => deleteMutation.mutate()}
          onRebuild={() => rebuildMutation.mutate()}
          isRebuilding={rebuildMutation.isPending}
        />
        <SegmentCriteriaSection segment={segment} />
        <SegmentMembersSection segmentId={id!} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <SegmentStatsSidebar
          segment={segment}
          onRebuild={() => rebuildMutation.mutate()}
          isRebuilding={rebuildMutation.isPending}
        />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export default SegmentDetailPage

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    return match.params.id || "Segment"
  },
}
