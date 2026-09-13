import { Button, Heading, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { getRunNextAction, type RunActionKey } from "../../lib/run-phase"

/**
 * The one thing the partner has to do, at the top of the page (#2018).
 *
 * Founder's ask: *"move the action first where they see what they have to
 * do"*. Everything the partner must DO used to sit at the bottom of nine
 * stacked sections, inside the largest file in the app.
 *
 * 🔑 This REPLACES two separate derivations of the same state: the header's
 * `primaryAction` chain (the button) and a stage-guidance helper (a banner saying
 * the same thing in words, computed independently). One state, described twice,
 * is how they drift; the label and the sentence under it now come from the same
 * call.
 *
 * Presentational only — the mutations, confirmation prompts and forms stay in
 * the card, which owns them. This decides WHAT to offer, never how to run it.
 */
export const RunNextAction = ({
  run,
  isSample,
  actionable,
  isPending,
  onAction,
}: {
  run: any
  isSample?: boolean
  /** false when the partner's design assignment is cancelled — no actions. */
  actionable?: boolean
  isPending?: boolean
  onAction: (key: RunActionKey) => void
}) => {
  const { t } = useTranslation()
  const action = getRunNextAction(run, { isSample, actionable })

  if (!action) {
    // Nothing is owed. Say so plainly rather than rendering an empty block —
    // silence reads as "still loading", and a settled run must never show a
    // button (that is how work gets done twice).
    const status = String(run?.status || "")
    const doneKey =
      status === "cancelled"
        ? "partner.workOrders.nextAction.noneCancelled"
        : "partner.workOrders.nextAction.noneDone"
    if (status !== "cancelled" && status !== "completed") {
      return null
    }
    return (
      <div className="bg-ui-bg-subtle px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          {t(doneKey)}
        </Text>
      </div>
    )
  }

  return (
    <div className="bg-ui-bg-subtle flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Heading level="h3">{t(action.labelKey)}</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          {t(action.descriptionKey)}
        </Text>
      </div>
      {/* Full-width on a phone — the primary action should not be a small
          target wedged beside text at 400px. */}
      <Button
        size="large"
        isLoading={isPending}
        onClick={() => onAction(action.key)}
        className="w-full shrink-0 sm:w-auto"
      >
        {t(action.labelKey)}
      </Button>
    </div>
  )
}
