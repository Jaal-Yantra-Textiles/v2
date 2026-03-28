import { Badge, Button, Container, Heading, Input, Select, Tabs, Text, toast } from "@medusajs/ui"
import { Link, LoaderFunctionArgs, UIMatch, useLoaderData, useNavigate, useParams } from "react-router-dom"
import { useState } from "react"

import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import { productionRunLoader } from "./loader"
import { useCancelProductionRun, useUpdateProductionRun } from "../../../hooks/api/production-runs"
import { productionRunStatusColor as statusColor } from "../../../lib/status-colors"

const formatStatus = (s: string) => s.replace(/_/g, " ")

const ProductionRunDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const initialData = useLoaderData() as Awaited<{ production_run: any; tasks: any[] }>

  const run = initialData?.production_run
  const tasks = initialData?.tasks || []
  const cancelRun = useCancelProductionRun(id || "")
  const updateRun = useUpdateProductionRun(id || "")

  const canCancel = run?.status && !["completed", "cancelled"].includes(run.status)
  const canEdit = run && !run.accepted_at && !run.started_at && run.status !== "completed" && run.status !== "cancelled"

  const [editQuantity, setEditQuantity] = useState<string>("")
  const [editRole, setEditRole] = useState<string>("")
  const [editRunType, setEditRunType] = useState<string>("")
  const [isEditing, setIsEditing] = useState(false)

  const startEditing = () => {
    setEditQuantity(String(run?.quantity ?? ""))
    setEditRole(run?.role || "")
    setEditRunType(run?.run_type || "production")
    setIsEditing(true)
  }

  const handleSave = async () => {
    const updates: Record<string, any> = {}
    if (editQuantity && Number(editQuantity) !== run?.quantity) {
      updates.quantity = Number(editQuantity)
    }
    if (editRole !== (run?.role || "")) {
      updates.role = editRole || undefined
    }
    if (editRunType !== run?.run_type) {
      updates.run_type = editRunType
    }
    if (Object.keys(updates).length === 0) {
      setIsEditing(false)
      return
    }
    try {
      await updateRun.mutateAsync(updates)
      toast.success("Production run updated")
      setIsEditing(false)
      navigate(0)
    } catch (e: any) {
      toast.error(e?.message || "Failed to update")
    }
  }

  const handleCancel = async () => {
    try {
      await cancelRun.mutateAsync({ reason: "Admin cancelled" })
      toast.success("Production run cancelled")
      navigate(0) // reload the page to reflect the new status
    } catch (e: any) {
      toast.error(e?.message || "Failed to cancel")
    }
  }

  if (!id || !run) {
    return <TwoColumnPageSkeleton mainSections={1} sidebarSections={1} showJSON showMetadata />
  }

  return (
    <TwoColumnPage data={run} hasOutlet={true} showJSON showMetadata>
      <TwoColumnPage.Main>
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex flex-col gap-y-1">
              <div className="flex items-center gap-x-2">
                <Heading level="h1">
                  {run.run_type === "sample" ? "Sample" : "Production"} Run
                </Heading>
                <Badge color={statusColor(run.status)}>{formatStatus(String(run.status || "-"))}</Badge>
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {run.design_id ? (
                  <Link to={`/designs/${run.design_id}`} className="text-ui-fg-interactive hover:underline">
                    Design: {run.design_id}
                  </Link>
                ) : "No design linked"}
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              {run.status === "pending_review" && (
                <Link to="approve">
                  <Button size="small">Approve</Button>
                </Link>
              )}
              {canCancel && (
                <Button
                  size="small"
                  variant="danger"
                  isLoading={cancelRun.isPending}
                  onClick={handleCancel}
                >
                  Cancel Run
                </Button>
              )}
            </div>
          </div>

          <div className="px-6 py-4">
            <Tabs defaultValue="overview">
              <Tabs.List>
                <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
                <Tabs.Trigger value="tasks">Tasks ({tasks.length})</Tabs.Trigger>
                <Tabs.Trigger value="snapshot">Snapshot</Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="overview" className="mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Type</Text>
                    {isEditing ? (
                      <Select value={editRunType} onValueChange={setEditRunType}>
                        <Select.Trigger><Select.Value /></Select.Trigger>
                        <Select.Content>
                          <Select.Item value="production">Production</Select.Item>
                          <Select.Item value="sample">Sample</Select.Item>
                        </Select.Content>
                      </Select>
                    ) : (
                      <Text>{run.run_type === "sample" ? "Sample" : "Production"}</Text>
                    )}
                  </div>
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Partner</Text>
                    {run.partner_id ? (
                      <Link to={`/partners/${run.partner_id}`} className="text-ui-fg-interactive hover:underline">
                        <Text>{run.partner_id}</Text>
                      </Link>
                    ) : <Text>-</Text>}
                  </div>
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Quantity</Text>
                    {isEditing ? (
                      <Input
                        type="number"
                        min={1}
                        value={editQuantity}
                        onChange={(e) => setEditQuantity(e.target.value)}
                      />
                    ) : (
                      <Text>{String(run.quantity ?? "-")}</Text>
                    )}
                  </div>
                  <div>
                    <Text size="small" className="text-ui-fg-subtle">Role</Text>
                    {isEditing ? (
                      <Input
                        placeholder="e.g. manufacturing, cutting"
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value)}
                      />
                    ) : (
                      <Text>{String(run.role || "-")}</Text>
                    )}
                  </div>
                  {run.parent_run_id && (
                    <div>
                      <Text size="small" className="text-ui-fg-subtle">Parent Run</Text>
                      <Link to={`/production-runs/${run.parent_run_id}`} className="text-ui-fg-interactive hover:underline">
                        <Text>{run.parent_run_id}</Text>
                      </Link>
                    </div>
                  )}
                  {run.finish_notes && (
                    <div className="col-span-2">
                      <Text size="small" className="text-ui-fg-subtle">Partner Finish Notes</Text>
                      <Text size="small" className="mt-1">{run.finish_notes}</Text>
                    </div>
                  )}
                  {run.completion_notes && (
                    <div className="col-span-2">
                      <Text size="small" className="text-ui-fg-subtle">Partner Completion Notes</Text>
                      <Text size="small" className="mt-1">{run.completion_notes}</Text>
                    </div>
                  )}
                  {run.partner_cost_estimate && (
                    <div>
                      <Text size="small" className="text-ui-fg-subtle">
                        Partner Cost {run.cost_type === "per_unit" ? "(per unit)" : "(total)"}
                      </Text>
                      <Text>
                        {run.partner_cost_estimate}
                        {run.cost_type === "per_unit" && run.produced_quantity
                          ? ` × ${run.produced_quantity} = ${Math.round(run.partner_cost_estimate * run.produced_quantity * 100) / 100}`
                          : ""
                        }
                      </Text>
                    </div>
                  )}
                  {run.produced_quantity != null && (
                    <div className="col-span-2">
                      <Text size="small" className="text-ui-fg-subtle">Output / Yield</Text>
                      <div className="flex items-center gap-4 mt-1">
                        <Text size="small">
                          {run.produced_quantity} of {run.quantity} produced
                        </Text>
                        {(run.rejected_quantity || 0) > 0 && (
                          <Text size="small" className="text-ui-fg-error">
                            {run.rejected_quantity} rejected
                          </Text>
                        )}
                        <Badge size="2xsmall" color={
                          run.quantity > 0 && (run.produced_quantity / run.quantity) >= 0.9
                            ? "green"
                            : (run.produced_quantity / run.quantity) >= 0.7
                            ? "orange"
                            : "red"
                        }>
                          {run.quantity > 0 ? Math.round((run.produced_quantity / run.quantity) * 100) : 0}% yield
                        </Badge>
                      </div>
                      {run.rejection_reason && (
                        <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                          Reason: {run.rejection_reason.replace(/_/g, " ")}
                          {run.rejection_notes ? ` — ${run.rejection_notes}` : ""}
                        </Text>
                      )}
                    </div>
                  )}
                  {run.depends_on_run_ids?.length > 0 && (
                    <div className="col-span-2">
                      <Text size="small" className="text-ui-fg-subtle">Depends On</Text>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {run.depends_on_run_ids.map((depId: string) => (
                          <Link key={depId} to={`/production-runs/${depId}`}>
                            <Badge color="blue">{depId}</Badge>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Edit / Save buttons */}
                {canEdit && (
                  <div className="mt-4 flex gap-x-2">
                    {isEditing ? (
                      <>
                        <Button size="small" variant="secondary" onClick={() => setIsEditing(false)}>
                          Cancel
                        </Button>
                        <Button size="small" isLoading={updateRun.isPending} onClick={handleSave}>
                          Save Changes
                        </Button>
                      </>
                    ) : (
                      <Button size="small" variant="secondary" onClick={startEditing}>
                        Edit Details
                      </Button>
                    )}
                  </div>
                )}
              </Tabs.Content>

              <Tabs.Content value="tasks" className="mt-4">
                {!tasks.length ? (
                  <Text size="small" className="text-ui-fg-subtle">No tasks</Text>
                ) : (
                  <div className="flex flex-col gap-y-2">
                    {tasks.map((t: any) => (
                      <div key={String(t.id)} className="rounded-md border px-3 py-2">
                        <div className="flex items-center justify-between gap-x-2">
                          <Text weight="plus" size="small">
                            {String(t.title || t.name || t.id)}
                          </Text>
                          <Badge color={statusColor(String(t.status || ""))}>
                            {String(t.status || "-")}
                          </Badge>
                        </div>
                        {t.description && (
                          <Text size="small" className="text-ui-fg-subtle">
                            {String(t.description)}
                          </Text>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Tabs.Content>

              <Tabs.Content value="snapshot" className="mt-4">
                {run.snapshot ? (
                  <pre className="rounded-md border p-3 overflow-auto text-xs">
                    {JSON.stringify(run.snapshot, null, 2)}
                  </pre>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">No snapshot</Text>
                )}
              </Tabs.Content>
            </Tabs>
          </div>
        </Container>
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Details</Heading>
          </div>
          <div className="px-6 py-4 grid grid-cols-1 gap-3">
            <div>
              <Text size="small" className="text-ui-fg-subtle">Created</Text>
              <Text>{String(run.created_at || "-")}</Text>
            </div>
            <div>
              <Text size="small" className="text-ui-fg-subtle">Updated</Text>
              <Text>{String(run.updated_at || "-")}</Text>
            </div>
          </div>
        </Container>
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return `${id}`
  },
}

export async function loader({ params }: LoaderFunctionArgs) {
  return await productionRunLoader({ params })
}

export default ProductionRunDetailPage
