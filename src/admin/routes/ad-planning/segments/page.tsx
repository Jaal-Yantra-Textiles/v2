/**
 * Customer Segments Page
 * Create and manage customer segments for targeting
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Container,
  Heading,
  Text,
  Badge,
  Button,
  DataTable,
  createDataTableColumnHelper,
  useDataTable,
  DataTablePaginationState,
  FocusModal,
  Input,
  Label,
  Select,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { sdk } from "../../../lib/config"
import { Plus, Users } from "@medusajs/icons"

interface Segment {
  id: string
  name: string
  description: string | null
  segment_type: string
  criteria: any
  member_count: number | null
  is_dynamic: boolean
  status: string
  created_at: string
  updated_at: string
}

const columnHelper = createDataTableColumnHelper<Segment>()

const SegmentsPage = () => {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [searchValue, setSearchValue] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    segment_type: "behavioral",
    is_dynamic: true,
    criteria: {
      rules: [] as Array<{ field: string; operator: string; value: any }>,
      logic: "AND" as "AND" | "OR",
    },
  })

  // Rule form state
  const [newRule, setNewRule] = useState({ field: "", operator: ">=", value: "" })

  // Define columns inside component to have access to Router context
  const columns = useMemo(() => [
    columnHelper.accessor("name", {
      header: "Name",
      cell: ({ getValue, row }) => (
        <Link to={`/ad-planning/segments/${row.original.id}`}>
          <Text size="small" leading="compact" weight="plus" className="text-ui-fg-interactive hover:underline">
            {getValue()}
          </Text>
        </Link>
      ),
    }),
    columnHelper.accessor("segment_type", {
      header: "Type",
      cell: ({ getValue }) => {
        const type = getValue()
        const colors: Record<string, "green" | "blue" | "orange" | "purple" | "grey"> = {
          behavioral: "blue",
          demographic: "green",
          value: "purple",
          engagement: "orange",
          custom: "grey",
        }
        return (
          <Badge color={colors[type] || "grey"} size="xsmall">
            {type}
          </Badge>
        )
      },
    }),
    columnHelper.accessor("member_count", {
      header: "Members",
      cell: ({ getValue }) => {
        const count = getValue()
        return (
          <div className="flex items-center gap-1">
            <Users className="text-ui-fg-muted" />
            <Text size="small" leading="compact">
              {count?.toLocaleString() || 0}
            </Text>
          </div>
        )
      },
    }),
    columnHelper.accessor("is_dynamic", {
      header: "Dynamic",
      cell: ({ getValue }) => (
        <Badge color={getValue() ? "green" : "grey"} size="xsmall">
          {getValue() ? "Yes" : "No"}
        </Badge>
      ),
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ getValue }) => {
        const status = getValue()
        return (
          <Badge color={status === "active" ? "green" : "grey"} size="xsmall">
            {status}
          </Badge>
        )
      },
    }),
    columnHelper.accessor("created_at", {
      header: "Created",
      cell: ({ getValue }) => (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {new Date(getValue()).toLocaleDateString()}
        </Text>
      ),
    }),
  ], [])

  const limit = pagination.pageSize
  const offset = pagination.pageIndex * limit

  // Fetch segments
  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "segments", limit, offset, searchValue, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })
      if (typeFilter !== "all") {
        params.set("segment_type", typeFilter)
      }
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/segments?${params}`)
      return res
    },
  })

  // Create mutation
  const createSegment = useMutation({
    mutationFn: async (data: any) => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/segments", {
        method: "POST",
        body: data,
      })
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad-planning", "segments"] })
      toast.success("Segment created successfully")
      setCreateOpen(false)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create segment")
    },
  })

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      segment_type: "behavioral",
      is_dynamic: true,
      criteria: { rules: [], logic: "AND" },
    })
    setNewRule({ field: "", operator: ">=", value: "" })
  }

  const handleAddRule = () => {
    if (!newRule.field || !newRule.value) return
    setFormData({
      ...formData,
      criteria: {
        ...formData.criteria,
        rules: [...formData.criteria.rules, { ...newRule }],
      },
    })
    setNewRule({ field: "", operator: ">=", value: "" })
  }

  const handleRemoveRule = (index: number) => {
    setFormData({
      ...formData,
      criteria: {
        ...formData.criteria,
        rules: formData.criteria.rules.filter((_, i) => i !== index),
      },
    })
  }

  const handleCreate = () => {
    createSegment.mutate({
      name: formData.name,
      description: formData.description || null,
      segment_type: formData.segment_type,
      is_dynamic: formData.is_dynamic,
      criteria: formData.criteria,
      status: "active",
    })
  }

  const table = useDataTable({
    data: data?.segments || [],
    columns,
    getRowId: (segment) => segment.id,
    rowCount: data?.count || 0,
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: searchValue,
      onSearchChange: setSearchValue,
    },
  })

  const segmentTypes = [
    { value: "all", label: "All Types" },
    { value: "behavioral", label: "Behavioral" },
    { value: "demographic", label: "Demographic" },
    { value: "value", label: "Value-Based" },
    { value: "engagement", label: "Engagement" },
    { value: "custom", label: "Custom" },
  ]

  const operators = [
    { value: ">=", label: "Greater than or equal" },
    { value: "<=", label: "Less than or equal" },
    { value: ">", label: "Greater than" },
    { value: "<", label: "Less than" },
    { value: "==", label: "Equals" },
    { value: "!=", label: "Not equals" },
    { value: "contains", label: "Contains" },
  ]

  const commonFields = [
    { value: "total_orders", label: "Total Orders" },
    { value: "total_spent", label: "Total Spent" },
    { value: "avg_order_value", label: "Avg Order Value" },
    { value: "days_since_last_order", label: "Days Since Last Order" },
    { value: "engagement_score", label: "Engagement Score" },
    { value: "clv", label: "Customer Lifetime Value" },
    { value: "churn_risk", label: "Churn Risk Score" },
  ]

  return (
    <div className="flex flex-col gap-y-6">
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Customer Segments</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Create and manage customer segments for targeting
              </Text>
            </div>
            <div className="flex items-center gap-4">
              <DataTable.Search placeholder="Search segments..." />
              <Select
                size="small"
                value={typeFilter}
                onValueChange={setTypeFilter}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Filter by type" />
                </Select.Trigger>
                <Select.Content>
                  {segmentTypes.map((t) => (
                    <Select.Item key={t.value} value={t.value}>
                      {t.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Button size="small" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2" />
                Create Segment
              </Button>
            </div>
          </DataTable.Toolbar>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>

      {/* Create Modal */}
      <FocusModal open={createOpen} onOpenChange={setCreateOpen}>
        <FocusModal.Content>
          <FocusModal.Header>
            <Text size="large" weight="plus">Create Customer Segment</Text>
          </FocusModal.Header>
          <FocusModal.Body className="flex flex-col gap-y-6 p-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Segment Name</Label>
                <Input
                  placeholder="e.g., High Value Customers"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Segment Type</Label>
                <Select
                  value={formData.segment_type}
                  onValueChange={(v) => setFormData({ ...formData, segment_type: v })}
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {segmentTypes.filter(t => t.value !== "all").map((t) => (
                      <Select.Item key={t.value} value={t.value}>
                        {t.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                placeholder="Describe this segment..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            {/* Criteria Builder */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label>Segment Rules</Label>
                <Select
                  size="small"
                  value={formData.criteria.logic}
                  onValueChange={(v: "AND" | "OR") => setFormData({
                    ...formData,
                    criteria: { ...formData.criteria, logic: v }
                  })}
                >
                  <Select.Trigger className="w-24">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="AND">AND</Select.Item>
                    <Select.Item value="OR">OR</Select.Item>
                  </Select.Content>
                </Select>
              </div>

              {/* Existing Rules */}
              <div className="flex flex-col gap-2 mb-4">
                {formData.criteria.rules.map((rule, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 bg-ui-bg-subtle rounded">
                    <Badge color="grey" size="xsmall">{rule.field}</Badge>
                    <Text size="small">{operators.find(o => o.value === rule.operator)?.label}</Text>
                    <Badge color="blue" size="xsmall">{rule.value}</Badge>
                    <Button
                      size="small"
                      variant="transparent"
                      onClick={() => handleRemoveRule(index)}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>

              {/* Add Rule */}
              <div className="grid grid-cols-4 gap-2">
                <Select
                  size="small"
                  value={newRule.field}
                  onValueChange={(v) => setNewRule({ ...newRule, field: v })}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="Field" />
                  </Select.Trigger>
                  <Select.Content>
                    {commonFields.map((f) => (
                      <Select.Item key={f.value} value={f.value}>
                        {f.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
                <Select
                  size="small"
                  value={newRule.operator}
                  onValueChange={(v) => setNewRule({ ...newRule, operator: v })}
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {operators.map((o) => (
                      <Select.Item key={o.value} value={o.value}>
                        {o.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
                <Input
                  size="small"
                  placeholder="Value"
                  value={newRule.value}
                  onChange={(e) => setNewRule({ ...newRule, value: e.target.value })}
                />
                <Button size="small" variant="secondary" onClick={handleAddRule}>
                  Add Rule
                </Button>
              </div>
            </div>
          </FocusModal.Body>
          <FocusModal.Footer>
            <Button
              variant="secondary"
              onClick={() => {
                setCreateOpen(false)
                resetForm()
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              isLoading={createSegment.isPending}
              disabled={!formData.name}
            >
              Create Segment
            </Button>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Segments",
})

export const handle = {
  breadcrumb: () => "Customer Segments",
}

export default SegmentsPage
