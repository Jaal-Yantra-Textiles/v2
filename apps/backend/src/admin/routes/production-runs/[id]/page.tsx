import {
  Badge,
  Button,
  Container,
  DropdownMenu,
  Heading,
  IconButton,
  StatusBadge,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import {
  ArrowPath,
  CheckCircle,
  EllipsisHorizontal,
  PencilSquare,
  PlayMiniSolid,
  Trash,
  Users,
  XMark,
} from "@medusajs/icons"
import {
  Link,
  LoaderFunctionArgs,
  UIMatch,
  useLoaderData,
  useNavigate,
  useParams,
} from "react-router-dom"

import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import { ProductionRunChildrenSection } from "../../../components/production-runs/production-run-children-section"
import { ProductionRunActivityTimeline } from "../../../components/production-runs/production-run-activity-timeline"
import { productionRunLoader } from "./loader"
import {
  useAdminAcceptRun,
  useAdminFinishRun,
  useAdminStartRun,
  useCancelProductionRun,
  useProductionRun,
  useProductionRuns,
  useUpdateProductionRun,
} from "../../../hooks/api/production-runs"
import { productionRunStatusColor as statusColor } from "../../../lib/status-colors"

const formatStatus = (s: string) => s.replace(/_/g, " ")

const ProductionRunDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const prompt = usePrompt()
  const initialData = useLoaderData() as Awaited<{ production_run: any; tasks: any[] }>

  const liveData = useProductionRun(id || "", undefined, {
    initialData: initialData as any,
    enabled: !!id,
  })

  const run = liveData?.production_run || initialData?.production_run
  const tasks = liveData?.tasks || initialData?.tasks || []
  const cancelRun = useCancelProductionRun(id || "")
  const updateRun = useUpdateProductionRun(id || "")
  const acceptRun = useAdminAcceptRun(id || "")
  const startRun = useAdminStartRun(id || "")
  const finishRun = useAdminFinishRun(id || "")

  // A run is treated as a parent aggregator when it has at least one child run.
  // Parents should never show dispatch/cost/partner controls — those belong on
  // the sub-runs themselves.
  const { production_runs: children } = useProductionRuns(
    { parent_run_id: id, limit: 1, offset: 0 },
    { enabled: !!id }
  )
  const isParent = !!(children && children.length > 0)

  const canCancel = run?.status && !["completed", "cancelled"].includes(run.status)
  const canEdit = run && run.status !== "completed" && run.status !== "cancelled"
  const canEditCost = run && !isParent && run.status !== "cancelled"
  const canDispatch =
    !isParent &&
    run?.status === "approved" &&
    run?.dispatch_state === "idle" &&
    !run?.dispatch_completed_at &&
    !!run?.partner_id

  // ── Admin lifecycle actions (accept / start / finish) ──────────────────
  // Admin can act on behalf of the assigned partner. Each is gated by the
  // run's current lifecycle state and the presence of a partner.
  const hasPartner = !!run?.partner_id
  const notTerminal = !!run?.status && !["completed", "cancelled"].includes(run.status)
  const canAccept =
    !isParent && hasPartner && notTerminal && run?.status === "sent_to_partner" && !run?.accepted_at
  const canStart =
    !isParent && hasPartner && notTerminal && !!run?.accepted_at && !run?.started_at
  const canFinish =
    !isParent && hasPartner && notTerminal && !!run?.started_at && !run?.finished_at

  // #1228 — a run parked by the reminder cap (or a decline) has no partner and
  // no other control on this page; this is its only way back into production.
  const isParked = run?.status === "awaiting_reassignment"
  // Reassignment is also a plain correction before the partner has accepted.
  const canAssignPartner =
    !isParent &&
    !run?.accepted_at &&
    ["awaiting_reassignment", "draft", "pending_review", "approved", "sent_to_partner"].includes(
      String(run?.status)
    )
  const lastPartnerId = run?.partner_id || run?.previous_partner_id || null

  const handleCancel = async () => {
    const confirmed = await prompt({
      title: "Cancel production run",
      description: "This cannot be undone. Continue?",
      confirmText: "Cancel run",
      cancelText: "Keep",
    })
    if (!confirmed) return
    try {
      await cancelRun.mutateAsync({ reason: "Admin cancelled" })
      toast.success("Production run cancelled")
    } catch (e: any) {
      toast.error(e?.message || "Failed to cancel")
    }
  }

  const handleClearCost = async () => {
    try {
      await updateRun.mutateAsync({ partner_cost_estimate: null })
      toast.success("Cost cleared")
    } catch (e: any) {
      toast.error(e?.message || "Failed to clear cost")
    }
  }

  const handleAccept = async () => {
    try {
      await acceptRun.mutateAsync()
      toast.success("Production run accepted")
    } catch (e: any) {
      toast.error(e?.message || "Failed to accept run")
    }
  }

  const handleStart = async () => {
    try {
      await startRun.mutateAsync()
      toast.success("Production run started")
    } catch (e: any) {
      toast.error(e?.message || "Failed to start run")
    }
  }

  const handleFinish = async () => {
    const confirmed = await prompt({
      title: "Finish production run",
      description: "This marks the run as finished. You can add optional notes. Continue?",
      confirmText: "Finish run",
      cancelText: "Keep",
    })
    if (!confirmed) return
    try {
      await finishRun.mutateAsync({})
      toast.success("Production run finished")
    } catch (e: any) {
      toast.error(e?.message || "Failed to finish run")
    }
  }

  if (!id || !run) {
    return <TwoColumnPageSkeleton mainSections={1} sidebarSections={1} showJSON showMetadata />
  }

  const hasCost = run?.partner_cost_estimate != null
  const isOverride = !!run.accepted_at || !!run.started_at

  return (
    <TwoColumnPage data={run} hasOutlet={true} showJSON showMetadata>
      <TwoColumnPage.Main>
        {/* Header */}
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex flex-col gap-y-1">
              <div className="flex items-center gap-x-2">
                <Heading level="h1">
                  {run.run_type === "sample" ? "Sample" : "Production"} Run
                </Heading>
                <StatusBadge color={statusColor(run.status)}>
                  {formatStatus(String(run.status || "-"))}
                </StatusBadge>
                {isParent && <Badge color="blue">parent</Badge>}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {run.design_id ? (
                  <Link
                    to={`/designs/${run.design_id}`}
                    className="text-ui-fg-interactive hover:underline"
                  >
                    {run.snapshot?.design?.name || run.design_id}
                  </Link>
                ) : (
                  "No design linked"
                )}
                {run.parent_run_id && (
                  <>
                    {" · "}Sub-run of{" "}
                    <Link
                      to={`/production-runs/${run.parent_run_id}`}
                      className="text-ui-fg-interactive hover:underline"
                    >
                      parent
                    </Link>
                  </>
                )}
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              {/* Admin lifecycle actions — accept → start → finish, on behalf
                  of the assigned partner. Cancel lives in the overflow menu. */}
              {canAccept && (
                <Button
                  size="small"
                  variant="secondary"
                  onClick={handleAccept}
                  disabled={acceptRun.isPending}
                >
                  <CheckCircle className="mr-1.5" />
                  Accept
                </Button>
              )}
              {canStart && (
                <Button
                  size="small"
                  variant="secondary"
                  onClick={handleStart}
                  disabled={startRun.isPending}
                >
                  <PlayMiniSolid className="mr-1.5" />
                  Start
                </Button>
              )}
              {canFinish && (
                <Button
                  size="small"
                  variant="secondary"
                  onClick={handleFinish}
                  disabled={finishRun.isPending}
                >
                  <CheckCircle className="mr-1.5" />
                  Finish
                </Button>
              )}
              {canCancel && !canAccept && !canStart && !canFinish && !canDispatch && !isParked && (
                <Button
                  size="small"
                  variant="danger"
                  onClick={handleCancel}
                  disabled={cancelRun.isPending}
                >
                  <XMark className="mr-1.5" />
                  Cancel run
                </Button>
              )}
              {run.status === "pending_review" && (
                <Link to="approve">
                  <Button size="small">Approve</Button>
                </Link>
              )}
              {canDispatch && (
                <Link to="dispatch">
                  <Button size="small" variant="secondary">
                    Dispatch to Partner
                  </Button>
                </Link>
              )}
              {/* A parked run is a dead end without this — promote it out of the
                  overflow menu so the queue is actionable at a glance. */}
              {isParked && canAssignPartner && (
                <Link to={lastPartnerId ? "reassign?mode=same" : "reassign"}>
                  <Button size="small">Reassign</Button>
                </Link>
              )}
              <DropdownMenu>
                <DropdownMenu.Trigger asChild>
                  <IconButton size="small" variant="transparent" aria-label="Actions">
                    <EllipsisHorizontal />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  {canEdit && (
                    <DropdownMenu.Item onClick={() => navigate("edit")}>
                      <PencilSquare className="mr-2" />
                      {isOverride ? "Edit details (override)" : "Edit details"}
                    </DropdownMenu.Item>
                  )}
                  {canAssignPartner && (
                    <>
                      <DropdownMenu.Separator />
                      {lastPartnerId && (
                        <DropdownMenu.Item
                          onClick={() => navigate("reassign?mode=same")}
                        >
                          <ArrowPath className="mr-2" />
                          Send to the same partner again
                        </DropdownMenu.Item>
                      )}
                      <DropdownMenu.Item onClick={() => navigate("reassign")}>
                        <Users className="mr-2" />
                        Assign a different partner
                      </DropdownMenu.Item>
                    </>
                  )}
                  {canEditCost && (
                    <>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onClick={() => navigate("cost?type=total")}>
                        Set total cost
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onClick={() => navigate("cost?type=per_unit")}
                      >
                        Set per-unit cost
                      </DropdownMenu.Item>
                      {hasCost && (
                        <DropdownMenu.Item
                          className="text-ui-fg-error"
                          onClick={handleClearCost}
                        >
                          <Trash className="mr-2" />
                          Clear cost
                        </DropdownMenu.Item>
                      )}
                    </>
                  )}
                  {canCancel && (
                    <>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        className="text-ui-fg-error"
                        onClick={handleCancel}
                      >
                        <XMark className="mr-2" />
                        Cancel run
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu>
            </div>
          </div>
        </Container>

        {/* Overview */}
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <Heading level="h2">Overview</Heading>
            {isParent && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Aggregator — partner, quantity split, and cost live on sub-runs
              </Text>
            )}
          </div>
          <div className="px-6 py-4 grid grid-cols-2 gap-4">
            <div>
              <Text size="small" className="text-ui-fg-subtle">
                Type
              </Text>
              <Text>{run.run_type === "sample" ? "Sample" : "Production"}</Text>
            </div>
            {!isParent && (
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Partner
                </Text>
                {run.partner_id ? (
                  <Link
                    to={`/partners/${run.partner_id}`}
                    className="text-ui-fg-interactive hover:underline"
                  >
                    <Text>
                      {run.snapshot?.provenance?.partner_name || run.partner_id}
                    </Text>
                  </Link>
                ) : (
                  <Text>-</Text>
                )}
              </div>
            )}
            <div>
              <Text size="small" className="text-ui-fg-subtle">
                Quantity
              </Text>
              <Text>{String(run.quantity ?? "-")}</Text>
            </div>
            <div>
              <Text size="small" className="text-ui-fg-subtle">
                Role
              </Text>
              <Text>{String(run.role || "-")}</Text>
            </div>
            {run.finish_notes && (
              <div className="col-span-2">
                <Text size="small" className="text-ui-fg-subtle">
                  Partner Finish Notes
                </Text>
                <Text size="small" className="mt-1">
                  {run.finish_notes}
                </Text>
              </div>
            )}
            {run.completion_notes && (
              <div className="col-span-2">
                <Text size="small" className="text-ui-fg-subtle">
                  Partner Completion Notes
                </Text>
                <Text size="small" className="mt-1">
                  {run.completion_notes}
                </Text>
              </div>
            )}

            {!isParent && (
              <div className="col-span-2">
                <Text size="small" className="text-ui-fg-subtle">
                  Partner Cost{" "}
                  {hasCost ? (run.cost_type === "per_unit" ? "(per unit)" : "(total)") : ""}
                </Text>
                <Text>
                  {hasCost
                    ? `${run.partner_cost_estimate}${
                        run.cost_type === "per_unit" && run.produced_quantity
                          ? ` × ${run.produced_quantity} = ${
                              Math.round(
                                run.partner_cost_estimate * run.produced_quantity * 100
                              ) / 100
                            }`
                          : ""
                      }`
                    : "-"}
                </Text>
              </div>
            )}

            {run.produced_quantity != null && (
              <div className="col-span-2">
                <Text size="small" className="text-ui-fg-subtle">
                  Output / Yield
                </Text>
                <div className="flex items-center gap-4 mt-1">
                  <Text size="small">
                    {run.produced_quantity} of {run.quantity} produced
                  </Text>
                  {(run.rejected_quantity || 0) > 0 && (
                    <Text size="small" className="text-ui-fg-error">
                      {run.rejected_quantity} rejected
                    </Text>
                  )}
                  <Badge
                    size="2xsmall"
                    color={
                      run.quantity > 0 && run.produced_quantity / run.quantity >= 0.9
                        ? "green"
                        : run.produced_quantity / run.quantity >= 0.7
                          ? "orange"
                          : "red"
                    }
                  >
                    {run.quantity > 0
                      ? Math.round((run.produced_quantity / run.quantity) * 100)
                      : 0}
                    % yield
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
                <Text size="small" className="text-ui-fg-subtle">
                  Depends On
                </Text>
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
        </Container>

        {/* Children / Sub-runs */}
        {isParent && <ProductionRunChildrenSection parentId={id} />}

        {/* Tasks */}
        {!isParent && (
          <Container className="divide-y p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <Heading level="h2">Tasks</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {tasks.length} task{tasks.length === 1 ? "" : "s"}
              </Text>
            </div>
            <div className="px-6 py-4">
              {!tasks.length ? (
                <Text size="small" className="text-ui-fg-subtle">
                  No tasks
                </Text>
              ) : (
                <div className="flex flex-col gap-y-2">
                  {tasks.map((t: any) => {
                    const estCost = t.estimated_cost ? Number(t.estimated_cost) : null
                    const actCost = t.actual_cost ? Number(t.actual_cost) : null
                    const taskId = String(t.id)
                    return (
                      <Link
                        key={taskId}
                        to={`tasks/${taskId}`}
                        className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
                      >
                        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-3 py-2 transition-colors">
                          <div className="flex items-center justify-between gap-x-2">
                            <Text weight="plus" size="small">
                              {String(t.title || t.name || t.id)}
                            </Text>
                            <div className="flex items-center gap-2">
                              {(estCost != null || actCost != null) && (
                                <Text size="xsmall" className="text-ui-fg-muted">
                                  {actCost != null
                                    ? `Cost: ${actCost}`
                                    : estCost != null
                                      ? `Est: ${estCost}`
                                      : ""}
                                  {actCost != null &&
                                    estCost != null &&
                                    actCost !== estCost && (
                                      <span
                                        className={
                                          actCost > estCost
                                            ? " text-ui-fg-error"
                                            : " text-ui-fg-interactive"
                                        }
                                      >
                                        {" "}
                                        ({actCost > estCost ? "+" : ""}
                                        {Math.round((actCost - estCost) * 100) / 100})
                                      </span>
                                    )}
                                </Text>
                              )}
                              <StatusBadge color={statusColor(String(t.status || ""))}>
                                {String(t.status || "-")}
                              </StatusBadge>
                            </div>
                          </div>
                          {t.description && (
                            <Text size="small" className="text-ui-fg-subtle">
                              {String(t.description)}
                            </Text>
                          )}
                        </div>
                      </Link>
                    )
                  })}
                  {tasks.some((t: any) => t.actual_cost || t.estimated_cost) &&
                    (() => {
                      const actualCount = tasks.filter((t: any) => t.actual_cost).length
                      const estimatedCount = tasks.filter(
                        (t: any) => !t.actual_cost && t.estimated_cost
                      ).length
                      const total = tasks.reduce(
                        (sum: number, t: any) =>
                          sum +
                          (Number(t.actual_cost) || Number(t.estimated_cost) || 0),
                        0
                      )
                      return (
                        <div className="flex items-center justify-between rounded-md bg-ui-bg-subtle px-3 py-2 mt-1">
                          <div>
                            <Text
                              size="xsmall"
                              weight="plus"
                              className="text-ui-fg-subtle"
                            >
                              Total task costs
                            </Text>
                            <Text size="xsmall" className="text-ui-fg-muted">
                              {actualCount > 0 && `${actualCount} actual`}
                              {actualCount > 0 && estimatedCount > 0 && " + "}
                              {estimatedCount > 0 && `${estimatedCount} estimated`}
                            </Text>
                          </div>
                          <Text size="xsmall" weight="plus">
                            {total}
                          </Text>
                        </div>
                      )
                    })()}
                </div>
              )}
            </div>
          </Container>
        )}

        {id && <ProductionRunActivityTimeline runId={id} />}
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Details</Heading>
          </div>
          <div className="px-6 py-4 grid grid-cols-1 gap-3">
            <div>
              <Text size="small" className="text-ui-fg-subtle">
                Created
              </Text>
              <Text size="small">
                {run.created_at
                  ? new Date(run.created_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "-"}
              </Text>
            </div>
            <div>
              <Text size="small" className="text-ui-fg-subtle">
                Updated
              </Text>
              <Text size="small">
                {run.updated_at
                  ? new Date(run.updated_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "-"}
              </Text>
            </div>
          </div>
        </Container>
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => match.params.id ?? "",
}

export async function loader({ params }: LoaderFunctionArgs) {
  return await productionRunLoader({ params })
}

export default ProductionRunDetailPage
