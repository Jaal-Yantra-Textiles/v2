import { useTranslation } from "react-i18next"

import { ActivitiesSection, ActivityItem } from "../common/activities-section"

/**
 * #342 — sidebar Activity for a design work-order. Surfaces the production run's
 * lifecycle (placed → accepted → started → finished → completed) as activity
 * items, so the run card stays focused on the current action and the timeline
 * lives in the right column like a retail order's activity.
 */
export const WorkOrderActivitySection = ({
  order,
  productionRun,
}: {
  order: any
  productionRun?: any
}) => {
  const { t } = useTranslation()

  const items: ActivityItem[] = []
  if (order?.created_at) {
    items.push({
      id: "placed",
      title: t("partner.workOrders.activity.placed"),
      status: "",
      timestamp: order.created_at,
    })
  }
  const run = productionRun || {}
  const stages: Array<[string, string, string]> = [
    ["accepted", "accepted_at", t("partner.workOrders.activity.accepted")],
    ["started", "started_at", t("partner.workOrders.activity.started")],
    ["finished", "finished_at", t("partner.workOrders.activity.finished")],
    ["completed", "completed_at", t("partner.workOrders.activity.completed")],
  ]
  for (const [id, field, title] of stages) {
    if (run[field]) {
      items.push({ id, title, status: "", timestamp: run[field] })
    }
  }

  return (
    <ActivitiesSection title={t("partner.workOrders.activity.title")} items={items} />
  )
}
