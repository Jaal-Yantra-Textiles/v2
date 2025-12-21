import React from "react"
import { Button, Input, Text, Textarea } from "@medusajs/ui"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../ui/collapsible"
import { StepTimeline } from "./step-timeline"
import { bubbleClass } from "../utils/message"
import type { AiV2Step } from "../../../../hooks/api/ai-v2"
import type { AiV2RunStatus } from "../types"

export type RunDetailsPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  lastSteps?: AiV2Step[]
  hideEmptySteps?: boolean
  runId: string | null
  runStatus: AiV2RunStatus
  feedbackRating: "one" | "two" | "three" | "four" | "five"
  onFeedbackRatingChange: (value: "one" | "two" | "three" | "four" | "five") => void
  feedbackComment: string
  onFeedbackCommentChange: (value: string) => void
  feedbackSubmittedBy: string
  onFeedbackSubmittedByChange: (value: string) => void
  canSubmitFeedback: boolean
  submitFeedback: () => void
  feedbackPending: boolean
  feedbackSubmittedForRunId: string | null
}

export const RunDetailsPanel: React.FC<RunDetailsPanelProps> = ({
  open,
  onOpenChange,
  lastSteps,
  hideEmptySteps = false,
  runId,
  runStatus,
  feedbackRating,
  onFeedbackRatingChange,
  feedbackComment,
  onFeedbackCommentChange,
  feedbackSubmittedBy,
  onFeedbackSubmittedByChange,
  canSubmitFeedback,
  submitFeedback,
  feedbackPending,
  feedbackSubmittedForRunId,
}) => {
  const showTimeline = Array.isArray(lastSteps) && lastSteps.length > 0
  const showFeedback = Boolean(runId && runStatus === "completed")

  if (!showTimeline && !showFeedback) {
    return null
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="flex items-center justify-between gap-3 rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2">
        <Text className="text-ui-fg-subtle text-small">Run details</Text>
        <CollapsibleTrigger asChild>
          <button type="button" className="text-ui-fg-subtle text-small underline underline-offset-4">
            {open ? "Hide" : "Show"}
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-2 flex w-full flex-col gap-3 sm:flex-row sm:items-start">
          {showTimeline ? (
            <div className="w-full sm:w-[420px]">
              <StepTimeline steps={lastSteps} hideEmpty={hideEmptySteps} />
            </div>
          ) : null}

          {showFeedback ? (
            <div className={`w-full sm:w-[420px] rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 ${bubbleClass("assistant")}`}>
              <div className="flex items-center justify-between gap-3">
                <Text className="text-ui-fg-subtle text-small">Feedback</Text>
                {feedbackSubmittedForRunId === runId ? (
                  <Text className="text-ui-fg-subtle text-small">Submitted</Text>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {([
                  { value: "one", label: "1" },
                  { value: "two", label: "2" },
                  { value: "three", label: "3" },
                  { value: "four", label: "4" },
                  { value: "five", label: "5" },
                ] as const).map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    size="small"
                    variant={feedbackRating === opt.value ? "primary" : "secondary"}
                    onClick={() => onFeedbackRatingChange(opt.value)}
                    disabled={!canSubmitFeedback || feedbackPending}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>

              <div className="mt-2">
                <Textarea
                  rows={2}
                  value={feedbackComment}
                  onChange={(e) => onFeedbackCommentChange(e.target.value)}
                  placeholder="Optional comment"
                  disabled={!canSubmitFeedback || feedbackPending}
                />
              </div>

              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Input
                  value={feedbackSubmittedBy}
                  onChange={(e) => onFeedbackSubmittedByChange(e.target.value)}
                  placeholder="Submitted by"
                  disabled={!canSubmitFeedback || feedbackPending}
                />

                <Button
                  type="button"
                  size="small"
                  onClick={submitFeedback}
                  isLoading={feedbackPending}
                  disabled={!canSubmitFeedback}
                >
                  Submit
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export default RunDetailsPanel
