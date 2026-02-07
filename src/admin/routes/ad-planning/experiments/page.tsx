/**
 * A/B Experiments List Page
 * Create, manage, and analyze A/B experiments
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
import { Link, useNavigate } from "react-router-dom"
import { sdk } from "../../../lib/config"
import { Plus } from "@medusajs/icons"

interface Experiment {
  id: string
  name: string
  description: string | null
  status: "draft" | "running" | "paused" | "completed"
  primary_metric: string
  variants: Array<{ id: string; name: string; weight: number; config?: any }>
  target_sample_size: number | null
  confidence_level: number
  is_significant: boolean | null
  p_value: number | null
  improvement_percent: number | null
  started_at: string | null
  ended_at: string | null
  created_at: string
}

const columnHelper = createDataTableColumnHelper<Experiment>()

const ExperimentsPage = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [searchValue, setSearchValue] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    primary_metric: "conversion_rate",
    traffic_split: 50,
    target_sample_size: 1000,
    confidence_level: 0.95,
    control_name: "Control",
    treatment_name: "Treatment",
    control_config: "{}",
    treatment_config: "{}",
  })

  // Define columns inside component
  const columns = useMemo(() => [
    columnHelper.accessor("name", {
      header: "Name",
      cell: ({ getValue, row }) => (
        <Link
          to={`/ad-planning/experiments/${row.original.id}`}
          className="text-left"
        >
          <Text size="small" leading="compact" weight="plus" className="text-ui-fg-interactive hover:underline">
            {getValue()}
          </Text>
        </Link>
      ),
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ getValue }) => {
        const status = getValue()
        const colors: Record<string, "green" | "blue" | "orange" | "grey"> = {
          running: "green",
          completed: "blue",
          paused: "orange",
          draft: "grey",
        }
        return (
          <Badge color={colors[status]} size="xsmall">
            {status}
          </Badge>
        )
      },
    }),
    columnHelper.accessor("primary_metric", {
      header: "Metric",
      cell: ({ getValue }) => (
        <Text size="small" leading="compact" className="capitalize">
          {getValue().replace(/_/g, " ")}
        </Text>
      ),
    }),
    columnHelper.accessor("variants", {
      header: "Traffic Split",
      cell: ({ getValue }) => {
        const variants = getValue()
        const controlWeight = variants?.[0]?.weight ?? 50
        return (
          <Text size="small" leading="compact">
            {controlWeight}% / {100 - controlWeight}%
          </Text>
        )
      },
    }),
    columnHelper.accessor("improvement_percent", {
      header: "Lift",
      cell: ({ getValue, row }) => {
        const lift = getValue()
        const status = row.original.status
        if (status !== "completed" || lift === null) {
          return <Text className="text-ui-fg-muted">-</Text>
        }
        const isPositive = lift > 0
        return (
          <Text
            size="small"
            leading="compact"
            className={isPositive ? "text-ui-fg-positive" : "text-ui-fg-error"}
          >
            {isPositive ? "+" : ""}{lift.toFixed(2)}%
          </Text>
        )
      },
    }),
    columnHelper.accessor("is_significant", {
      header: "Significant",
      cell: ({ getValue, row }) => {
        const significant = getValue()
        const status = row.original.status
        if (status !== "completed" || significant === null) {
          return <Text className="text-ui-fg-muted">-</Text>
        }
        return (
          <Badge color={significant ? "green" : "grey"} size="xsmall">
            {significant ? "Yes" : "No"}
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

  // Fetch experiments
  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "experiments", limit, offset, searchValue, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })
      if (statusFilter !== "all") {
        params.set("status", statusFilter)
      }
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/experiments?${params}`)
      return res
    },
  })

  // Create mutation
  const createExperiment = useMutation({
    mutationFn: async (data: any) => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/experiments", {
        method: "POST",
        body: data,
      })
      return res
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["ad-planning", "experiments"] })
      toast.success("Experiment created successfully")
      setCreateOpen(false)
      navigate(`/ad-planning/experiments/${result.experiment.id}`)
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create experiment")
    },
  })

  const handleCreate = () => {
    createExperiment.mutate({
      name: formData.name,
      description: formData.description || null,
      primary_metric: formData.primary_metric,
      traffic_split: formData.traffic_split,
      target_sample_size: formData.target_sample_size,
      confidence_level: formData.confidence_level,
      control_name: formData.control_name,
      treatment_name: formData.treatment_name,
      control_config: JSON.parse(formData.control_config || "{}"),
      treatment_config: JSON.parse(formData.treatment_config || "{}"),
    })
  }

  const table = useDataTable({
    data: data?.experiments || [],
    columns,
    getRowId: (exp) => exp.id,
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

  const metrics = [
    { value: "conversion_rate", label: "Conversion Rate" },
    { value: "ctr", label: "Click-Through Rate" },
    { value: "cpc", label: "Cost per Click" },
    { value: "roas", label: "Return on Ad Spend" },
    { value: "leads", label: "Leads" },
    { value: "revenue", label: "Revenue" },
  ]

  const statuses = [
    { value: "all", label: "All Statuses" },
    { value: "draft", label: "Draft" },
    { value: "running", label: "Running" },
    { value: "paused", label: "Paused" },
    { value: "completed", label: "Completed" },
  ]

  return (
    <div className="flex flex-col gap-y-6">
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>A/B Experiments</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Create and manage A/B testing experiments
              </Text>
            </div>
            <div className="flex items-center gap-4">
              <DataTable.Search placeholder="Search experiments..." />
              <Select
                size="small"
                value={statusFilter}
                onValueChange={setStatusFilter}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Filter by status" />
                </Select.Trigger>
                <Select.Content>
                  {statuses.map((s) => (
                    <Select.Item key={s.value} value={s.value}>
                      {s.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Button size="small" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2" />
                Create Experiment
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
            <Text size="large" weight="plus">Create A/B Experiment</Text>
          </FocusModal.Header>
          <FocusModal.Body className="flex flex-col gap-y-6 p-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Experiment Name</Label>
                <Input
                  placeholder="e.g., Homepage CTA Test"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Primary Metric</Label>
                <Select
                  value={formData.primary_metric}
                  onValueChange={(v) => setFormData({ ...formData, primary_metric: v })}
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {metrics.map((m) => (
                      <Select.Item key={m.value} value={m.value}>
                        {m.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                placeholder="Describe what you're testing..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Traffic Split (%)</Label>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={formData.traffic_split}
                  onChange={(e) => setFormData({ ...formData, traffic_split: parseInt(e.target.value) })}
                />
                <Text size="xsmall" className="text-ui-fg-muted mt-1">
                  Control: {formData.traffic_split}% / Treatment: {100 - formData.traffic_split}%
                </Text>
              </div>
              <div>
                <Label>Target Sample Size</Label>
                <Input
                  type="number"
                  min={100}
                  value={formData.target_sample_size}
                  onChange={(e) => setFormData({ ...formData, target_sample_size: parseInt(e.target.value) })}
                />
              </div>
              <div>
                <Label>Confidence Level</Label>
                <Select
                  value={formData.confidence_level.toString()}
                  onValueChange={(v) => setFormData({ ...formData, confidence_level: parseFloat(v) })}
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="0.90">90%</Select.Item>
                    <Select.Item value="0.95">95%</Select.Item>
                    <Select.Item value="0.99">99%</Select.Item>
                  </Select.Content>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Control Variant Name</Label>
                <Input
                  value={formData.control_name}
                  onChange={(e) => setFormData({ ...formData, control_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Treatment Variant Name</Label>
                <Input
                  value={formData.treatment_name}
                  onChange={(e) => setFormData({ ...formData, treatment_name: e.target.value })}
                />
              </div>
            </div>
          </FocusModal.Body>
          <FocusModal.Footer>
            <Button
              variant="secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              isLoading={createExperiment.isPending}
              disabled={!formData.name}
            >
              Create Experiment
            </Button>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Experiments",
})

export const handle = {
  breadcrumb: () => "Experiments",
}

export default ExperimentsPage
