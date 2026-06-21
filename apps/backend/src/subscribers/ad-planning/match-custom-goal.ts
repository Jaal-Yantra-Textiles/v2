/**
 * Pure matcher for the analytics_event.created → custom-goal branch.
 *
 * Extracted from the subscriber so the matching contract is unit-testable
 * (and so the #568 regression — querying goal_type "custom" and reading a
 * non-existent `trigger_event_name` column — can never silently come back).
 *
 * A custom goal matches when its `conditions.event_name` equals the incoming
 * analytics event name (case-insensitive). The event name lives in the
 * `conditions` JSON; the ConversionGoal model has no `trigger_event_name`
 * column.
 */
export type CustomGoalLike = {
  conditions?: { event_name?: string | null } | null
  [key: string]: any
}

export function findMatchingCustomGoal<T extends CustomGoalLike>(
  goals: T[],
  eventName: string | null | undefined
): T | undefined {
  const target = (eventName || "").trim().toLowerCase()
  if (!target) return undefined

  return goals.find((goal) => {
    const goalEventName = goal?.conditions?.event_name
      ?.toString()
      .trim()
      .toLowerCase()
    return !!goalEventName && goalEventName === target
  })
}
