import {
  Text,
  clx,
} from "@medusajs/ui"

export const STEPS = [
  { key: "received", label: "Received" },
  { key: "accepted", label: "Accepted" },
  { key: "started", label: "Started" },
  { key: "finished", label: "Finished" },
  { key: "completed", label: "Completed" },
]

export const ProgressStepper = ({ run }: { run: any }) => {
  const status = String(run.status || "")
  if (status === "cancelled") return null

  // Determine step from timestamps first, fall back to status field
  // (handles cases where status was set via task-completion subscriber without lifecycle timestamps)
  let currentIdx = 0
  if (run.completed_at || status === "completed") currentIdx = 4
  else if (run.finished_at) currentIdx = 3
  else if (run.started_at || status === "in_progress") currentIdx = 2
  else if (run.accepted_at) currentIdx = 1
  else if (status === "sent_to_partner") currentIdx = 0

  return (
    <div className="flex items-center gap-1 px-6 py-3">
      {STEPS.map((step, idx) => {
        const isDone = idx <= currentIdx
        const isCurrent = idx === currentIdx
        return (
          <div key={step.key} className="flex items-center gap-1 flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={clx("h-1.5 w-full rounded-full", {
                  "bg-ui-fg-interactive": isDone,
                  "bg-ui-border-base": !isDone,
                })}
              />
              <Text
                size="xsmall"
                className={clx("mt-1", {
                  "text-ui-fg-base font-medium": isCurrent,
                  "text-ui-fg-subtle": isDone && !isCurrent,
                  "text-ui-fg-muted": !isDone,
                })}
              >
                {step.label}
              </Text>
            </div>
          </div>
        )
      })}
    </div>
  )
}
