/**
 * Experiment Detail Page
 * View experiment details, start/stop, and see results
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Container,
  Heading,
  Text,
  Badge,
  Button,
  toast,
} from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams, useNavigate, Link } from "react-router-dom"
import { sdk } from "../../../../lib/config"
import { ArrowLeftMini, PlaySolid, Pause, Trash } from "@medusajs/icons"

const ExperimentDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Fetch experiment
  const { data: experimentData, isLoading } = useQuery({
    queryKey: ["ad-planning", "experiment", id],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/experiments/${id}`)
      return res
    },
    enabled: !!id,
  })

  // Fetch results
  const { data: resultsData } = useQuery({
    queryKey: ["ad-planning", "experiment", id, "results"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/experiments/${id}/results`)
      return res
    },
    enabled: !!id,
  })

  // Start experiment
  const startExperiment = useMutation({
    mutationFn: async () => {
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/experiments/${id}/start`, {
        method: "POST",
      })
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad-planning", "experiment", id] })
      toast.success("Experiment started")
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to start experiment")
    },
  })

  // Stop experiment
  const stopExperiment = useMutation({
    mutationFn: async () => {
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/experiments/${id}/stop`, {
        method: "POST",
        body: { reason: "manual_stop" },
      })
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad-planning", "experiment", id] })
      queryClient.invalidateQueries({ queryKey: ["ad-planning", "experiment", id, "results"] })
      toast.success("Experiment stopped")
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to stop experiment")
    },
  })

  // Delete experiment
  const deleteExperiment = useMutation({
    mutationFn: async () => {
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/experiments/${id}`, {
        method: "DELETE",
      })
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad-planning", "experiments"] })
      toast.success("Experiment deleted")
      navigate("/ad-planning/experiments")
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete experiment")
    },
  })

  const experiment = experimentData?.experiment
  const results = resultsData?.results

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Text className="text-ui-fg-muted">Loading...</Text>
      </div>
    )
  }

  if (!experiment) {
    return (
      <div className="flex items-center justify-center p-12">
        <Text className="text-ui-fg-muted">Experiment not found</Text>
      </div>
    )
  }

  const statusColors: Record<string, "green" | "blue" | "orange" | "grey"> = {
    running: "green",
    completed: "blue",
    paused: "orange",
    draft: "grey",
  }

  return (
    <div className="flex flex-col gap-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/ad-planning/experiments">
            <Button variant="transparent" size="small">
              <ArrowLeftMini />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Heading level="h1">{experiment.name}</Heading>
              <Badge color={statusColors[experiment.status]} size="small">
                {experiment.status}
              </Badge>
            </div>
            {experiment.description && (
              <Text size="small" className="text-ui-fg-subtle mt-1">
                {experiment.description}
              </Text>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {experiment.status === "draft" && (
            <>
              <Button
                size="small"
                onClick={() => startExperiment.mutate()}
                isLoading={startExperiment.isPending}
              >
                <PlaySolid className="mr-2" />
                Start Experiment
              </Button>
              <Button
                size="small"
                variant="danger"
                onClick={() => deleteExperiment.mutate()}
                isLoading={deleteExperiment.isPending}
              >
                <Trash className="mr-2" />
                Delete
              </Button>
            </>
          )}
          {experiment.status === "running" && (
            <Button
              size="small"
              variant="secondary"
              onClick={() => stopExperiment.mutate()}
              isLoading={stopExperiment.isPending}
            >
              <Pause className="mr-2" />
              Stop Experiment
            </Button>
          )}
        </div>
      </div>

      {/* Configuration */}
      <Container className="p-0">
        <div className="px-6 py-4 border-b border-ui-border-base">
          <Text size="small" leading="compact" weight="plus">
            Configuration
          </Text>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">Primary Metric</Text>
            <Text size="small" weight="plus" className="capitalize mt-1">
              {experiment.primary_metric.replace(/_/g, " ")}
            </Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">Traffic Split</Text>
            <Text size="small" weight="plus" className="mt-1">
              {experiment.traffic_split}% / {100 - experiment.traffic_split}%
            </Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">Target Sample Size</Text>
            <Text size="small" weight="plus" className="mt-1">
              {experiment.target_sample_size?.toLocaleString() || "Not set"}
            </Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">Confidence Level</Text>
            <Text size="small" weight="plus" className="mt-1">
              {(experiment.confidence_level * 100).toFixed(0)}%
            </Text>
          </div>
        </div>
      </Container>

      {/* Variants */}
      <Container className="p-0">
        <div className="px-6 py-4 border-b border-ui-border-base">
          <Text size="small" leading="compact" weight="plus">
            Variants
          </Text>
        </div>
        <div className="divide-y divide-ui-border-base">
          {experiment.variants?.map((variant: any) => (
            <div key={variant.id} className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge color={variant.is_control ? "grey" : "blue"} size="xsmall">
                  {variant.is_control ? "Control" : "Treatment"}
                </Badge>
                <Text size="small" weight="plus">{variant.name}</Text>
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {experiment.traffic_split}% traffic
              </Text>
            </div>
          ))}
        </div>
      </Container>

      {/* Results */}
      {(experiment.status === "running" || experiment.status === "completed") && results && (
        <Container className="p-0">
          <div className="px-6 py-4 border-b border-ui-border-base">
            <Text size="small" leading="compact" weight="plus">
              Results
            </Text>
          </div>
          <div className="px-6 py-4">
            <div className="grid grid-cols-2 gap-6">
              {/* Control Results */}
              <div className="p-4 bg-ui-bg-subtle rounded-lg">
                <Text size="small" weight="plus" className="mb-4">Control</Text>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Visitors</Text>
                    <Text size="base" weight="plus">
                      {results.control?.samples?.toLocaleString() || 0}
                    </Text>
                  </div>
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Conversions</Text>
                    <Text size="base" weight="plus">
                      {results.control?.conversions?.toLocaleString() || 0}
                    </Text>
                  </div>
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Rate</Text>
                    <Text size="base" weight="plus">
                      {((results.control?.rate || 0) * 100).toFixed(2)}%
                    </Text>
                  </div>
                </div>
              </div>

              {/* Treatment Results */}
              <div className="p-4 bg-ui-bg-subtle rounded-lg">
                <Text size="small" weight="plus" className="mb-4">Treatment</Text>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Visitors</Text>
                    <Text size="base" weight="plus">
                      {results.treatment?.samples?.toLocaleString() || 0}
                    </Text>
                  </div>
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Conversions</Text>
                    <Text size="base" weight="plus">
                      {results.treatment?.conversions?.toLocaleString() || 0}
                    </Text>
                  </div>
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Rate</Text>
                    <Text size="base" weight="plus">
                      {((results.treatment?.rate || 0) * 100).toFixed(2)}%
                    </Text>
                  </div>
                </div>
              </div>
            </div>

            {/* Statistical Analysis */}
            <div className="mt-6 p-4 bg-ui-bg-subtle rounded-lg">
              <Text size="small" weight="plus" className="mb-4">Statistical Analysis</Text>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <Text size="xsmall" className="text-ui-fg-muted">Lift</Text>
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
                  <Text size="xsmall" className="text-ui-fg-muted">P-Value</Text>
                  <Text size="base" weight="plus">
                    {results.pValue?.toFixed(4) || "-"}
                  </Text>
                </div>
                <div>
                  <Text size="xsmall" className="text-ui-fg-muted">Confidence</Text>
                  <Text size="base" weight="plus">
                    {results.significance?.level || "none"}
                  </Text>
                </div>
                <div>
                  <Text size="xsmall" className="text-ui-fg-muted">Winner</Text>
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
            {resultsData?.recommendation && (
              <div className="mt-6 p-4 border border-ui-border-base rounded-lg">
                <Text size="small" weight="plus" className="mb-2">Recommendation</Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {resultsData.recommendation}
                </Text>
              </div>
            )}
          </div>
        </Container>
      )}

      {/* Timeline */}
      <Container className="p-0">
        <div className="px-6 py-4 border-b border-ui-border-base">
          <Text size="small" leading="compact" weight="plus">
            Timeline
          </Text>
        </div>
        <div className="px-6 py-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Text size="small" className="text-ui-fg-subtle">Created</Text>
            <Text size="small">{new Date(experiment.created_at).toLocaleString()}</Text>
          </div>
          {experiment.started_at && (
            <div className="flex items-center justify-between">
              <Text size="small" className="text-ui-fg-subtle">Started</Text>
              <Text size="small">{new Date(experiment.started_at).toLocaleString()}</Text>
            </div>
          )}
          {experiment.ended_at && (
            <div className="flex items-center justify-between">
              <Text size="small" className="text-ui-fg-subtle">Ended</Text>
              <Text size="small">{new Date(experiment.ended_at).toLocaleString()}</Text>
            </div>
          )}
        </div>
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Experiment Details",
})

export default ExperimentDetailPage
