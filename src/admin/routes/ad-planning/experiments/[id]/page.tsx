/**
 * Experiment Detail Page
 * View experiment details, start/stop, and see results
 */

import {
  Container,
  Heading,
  Text,
  Badge,
  toast,
  usePrompt,
  StatusBadge,
} from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams, useNavigate, UIMatch } from "react-router-dom"
import { PlaySolid, Pause, Trash } from "@medusajs/icons"
import { TwoColumnPage } from "../../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../../components/table/skeleton"
import { ActionMenu } from "../../../../components/common/action-menu"
import { sdk } from "../../../../lib/config"

const STATUS_COLORS: Record<string, "green" | "blue" | "orange" | "grey"> = {
  running: "green",
  completed: "blue",
  paused: "orange",
  draft: "grey",
}

// --- Section Components ---

const ExperimentGeneralSection = ({
  experiment,
  onStart,
  onStop,
  onDelete,
  isStarting,
  isStopping,
}: {
  experiment: any
  onStart: () => void
  onStop: () => void
  onDelete: () => void
  isStarting: boolean
  isStopping: boolean
}) => {
  const prompt = usePrompt()

  const handleDelete = async () => {
    const confirmed = await prompt({
      title: "Delete Experiment",
      description:
        "Are you sure you want to delete this experiment? This cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (confirmed) {
      onDelete()
    }
  }

  const actions = []

  if (experiment.status === "draft") {
    actions.push({
      actions: [
        {
          label: "Start Experiment",
          icon: <PlaySolid />,
          onClick: onStart,
          disabled: isStarting,
        },
      ],
    })
  }

  if (experiment.status === "running") {
    actions.push({
      actions: [
        {
          label: "Stop Experiment",
          icon: <Pause />,
          onClick: onStop,
          disabled: isStopping,
        },
      ],
    })
  }

  if (experiment.status === "draft") {
    actions.push({
      actions: [
        {
          label: "Delete",
          icon: <Trash />,
          onClick: handleDelete,
        },
      ],
    })
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Heading>{experiment.name}</Heading>
            <StatusBadge color={STATUS_COLORS[experiment.status] || "grey"}>
              {experiment.status.charAt(0).toUpperCase() +
                experiment.status.slice(1)}
            </StatusBadge>
          </div>
          {experiment.description && (
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {experiment.description}
            </Text>
          )}
        </div>
        {actions.length > 0 && <ActionMenu groups={actions} />}
      </div>

      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Primary Metric
        </Text>
        <Text size="small" leading="compact" className="capitalize">
          {experiment.primary_metric?.replace(/_/g, " ")}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Traffic Split
        </Text>
        <Text size="small" leading="compact">
          {(() => {
            const controlWeight = experiment.variants?.[0]?.weight ?? 50
            return `${controlWeight}% / ${100 - controlWeight}%`
          })()}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Target Sample Size
        </Text>
        <Text size="small" leading="compact">
          {experiment.target_sample_size?.toLocaleString() || "Not set"}
        </Text>
      </div>
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Confidence Level
        </Text>
        <Text size="small" leading="compact">
          {(experiment.confidence_level * 100).toFixed(0)}%
        </Text>
      </div>
    </Container>
  )
}

const ExperimentVariantsSection = ({ experiment }: { experiment: any }) => {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Variants</Heading>
      </div>
      <div className="divide-y divide-ui-border-base">
        {experiment.variants?.map((variant: any) => (
          <div
            key={variant.id}
            className="px-6 py-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Badge
                color={variant.is_control || variant.id === "control" ? "grey" : "blue"}
                size="xsmall"
              >
                {variant.is_control || variant.id === "control"
                  ? "Control"
                  : "Treatment"}
              </Badge>
              <Text size="small" weight="plus">
                {variant.name}
              </Text>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {variant.weight ?? 50}% traffic
            </Text>
          </div>
        ))}
      </div>
    </Container>
  )
}

const ExperimentResultsSection = ({
  experiment,
  results,
  recommendation,
}: {
  experiment: any
  results: any
  recommendation?: string
}) => {
  if (
    !(experiment.status === "running" || experiment.status === "completed") ||
    !results
  ) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Results</Heading>
      </div>
      <div className="px-6 py-4">
        <div className="grid grid-cols-2 gap-6">
          {/* Control Results */}
          <div className="p-4 bg-ui-bg-subtle rounded-lg">
            <Text size="small" weight="plus" className="mb-4">
              Control
            </Text>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Visitors
                </Text>
                <Text size="base" weight="plus">
                  {results.control?.samples?.toLocaleString() || 0}
                </Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Conversions
                </Text>
                <Text size="base" weight="plus">
                  {results.control?.conversions?.toLocaleString() || 0}
                </Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Rate
                </Text>
                <Text size="base" weight="plus">
                  {((results.control?.rate || 0) * 100).toFixed(2)}%
                </Text>
              </div>
            </div>
          </div>

          {/* Treatment Results */}
          <div className="p-4 bg-ui-bg-subtle rounded-lg">
            <Text size="small" weight="plus" className="mb-4">
              Treatment
            </Text>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Visitors
                </Text>
                <Text size="base" weight="plus">
                  {results.treatment?.samples?.toLocaleString() || 0}
                </Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Conversions
                </Text>
                <Text size="base" weight="plus">
                  {results.treatment?.conversions?.toLocaleString() || 0}
                </Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Rate
                </Text>
                <Text size="base" weight="plus">
                  {((results.treatment?.rate || 0) * 100).toFixed(2)}%
                </Text>
              </div>
            </div>
          </div>
        </div>

        {/* Statistical Analysis */}
        <div className="mt-6 p-4 bg-ui-bg-subtle rounded-lg">
          <Text size="small" weight="plus" className="mb-4">
            Statistical Analysis
          </Text>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Text size="xsmall" className="text-ui-fg-muted">
                Lift
              </Text>
              <Text
                size="base"
                weight="plus"
                className={
                  results.lift?.liftPercent > 0
                    ? "text-ui-fg-positive"
                    : results.lift?.liftPercent < 0
                    ? "text-ui-fg-error"
                    : ""
                }
              >
                {results.lift?.liftPercent > 0 ? "+" : ""}
                {results.lift?.liftPercent?.toFixed(2) || 0}%
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-muted">
                P-Value
              </Text>
              <Text size="base" weight="plus">
                {results.pValue?.toFixed(4) || "-"}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-muted">
                Confidence
              </Text>
              <Text size="base" weight="plus">
                {results.significance?.level || "none"}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-muted">
                Winner
              </Text>
              <Badge
                color={
                  results.winner === "treatment"
                    ? "green"
                    : results.winner === "control"
                    ? "blue"
                    : "grey"
                }
                size="small"
              >
                {results.winner || "Inconclusive"}
              </Badge>
            </div>
          </div>
        </div>

        {/* Recommendation */}
        {recommendation && (
          <div className="mt-6 p-4 border border-ui-border-base rounded-lg">
            <Text size="small" weight="plus" className="mb-2">
              Recommendation
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              {recommendation}
            </Text>
          </div>
        )}
      </div>
    </Container>
  )
}

const ExperimentSidebar = ({ experiment }: { experiment: any }) => {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Timeline</Heading>
      </div>
      <div className="px-6 py-4 space-y-4">
        <div>
          <Text size="xsmall" className="text-ui-fg-muted">
            Created
          </Text>
          <Text size="small" className="mt-1">
            {new Date(experiment.created_at).toLocaleString()}
          </Text>
        </div>
        {experiment.started_at && (
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">
              Started
            </Text>
            <Text size="small" className="mt-1">
              {new Date(experiment.started_at).toLocaleString()}
            </Text>
          </div>
        )}
        {experiment.ended_at && (
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">
              Ended
            </Text>
            <Text size="small" className="mt-1">
              {new Date(experiment.ended_at).toLocaleString()}
            </Text>
          </div>
        )}

        {experiment.is_significant !== null && (
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">
              Statistically Significant
            </Text>
            <div className="mt-1">
              <Badge
                color={experiment.is_significant ? "green" : "grey"}
                size="xsmall"
              >
                {experiment.is_significant ? "Yes" : "No"}
              </Badge>
            </div>
          </div>
        )}

        {experiment.p_value !== null && (
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">
              P-Value
            </Text>
            <Text size="small" weight="plus" className="mt-1">
              {experiment.p_value?.toFixed(4)}
            </Text>
          </div>
        )}

        {experiment.improvement_percent !== null && (
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">
              Improvement
            </Text>
            <Text
              size="small"
              weight="plus"
              className={`mt-1 ${
                experiment.improvement_percent > 0
                  ? "text-ui-fg-positive"
                  : experiment.improvement_percent < 0
                  ? "text-ui-fg-error"
                  : ""
              }`}
            >
              {experiment.improvement_percent > 0 ? "+" : ""}
              {experiment.improvement_percent?.toFixed(2)}%
            </Text>
          </div>
        )}
      </div>
    </Container>
  )
}

// --- Main Page ---

const ExperimentDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: experimentData, isLoading } = useQuery({
    queryKey: ["ad-planning", "experiment", id],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        `/admin/ad-planning/experiments/${id}`
      )
      return res
    },
    enabled: !!id,
  })

  const { data: resultsData } = useQuery({
    queryKey: ["ad-planning", "experiment", id, "results"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(
        `/admin/ad-planning/experiments/${id}/results`
      )
      return res
    },
    enabled: !!id,
  })

  const startExperiment = useMutation({
    mutationFn: async () => {
      return await sdk.client.fetch<any>(
        `/admin/ad-planning/experiments/${id}/start`,
        { method: "POST" }
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["ad-planning", "experiment", id],
      })
      toast.success("Experiment started")
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to start experiment")
    },
  })

  const stopExperiment = useMutation({
    mutationFn: async () => {
      return await sdk.client.fetch<any>(
        `/admin/ad-planning/experiments/${id}/stop`,
        { method: "POST", body: { reason: "manual_stop" } }
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["ad-planning", "experiment", id],
      })
      queryClient.invalidateQueries({
        queryKey: ["ad-planning", "experiment", id, "results"],
      })
      toast.success("Experiment stopped")
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to stop experiment")
    },
  })

  const deleteExperiment = useMutation({
    mutationFn: async () => {
      return await sdk.client.fetch<any>(
        `/admin/ad-planning/experiments/${id}`,
        { method: "DELETE" }
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["ad-planning", "experiments"],
      })
      toast.success("Experiment deleted")
      navigate("/ad-planning/experiments")
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete experiment")
    },
  })

  if (isLoading) {
    return (
      <TwoColumnPageSkeleton
        mainSections={3}
        sidebarSections={1}
        showJSON
      />
    )
  }

  const experiment = experimentData?.experiment

  if (!experiment) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-error">Experiment not found</Text>
      </Container>
    )
  }

  return (
    <TwoColumnPage showJSON data={experiment}>
      <TwoColumnPage.Main>
        <ExperimentGeneralSection
          experiment={experiment}
          onStart={() => startExperiment.mutate()}
          onStop={() => stopExperiment.mutate()}
          onDelete={() => deleteExperiment.mutate()}
          isStarting={startExperiment.isPending}
          isStopping={stopExperiment.isPending}
        />
        <ExperimentVariantsSection experiment={experiment} />
        <ExperimentResultsSection
          experiment={experiment}
          results={resultsData?.results}
          recommendation={resultsData?.recommendation}
        />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <ExperimentSidebar experiment={experiment} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export default ExperimentDetailPage

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    return match.params.id || "Experiment"
  },
}
