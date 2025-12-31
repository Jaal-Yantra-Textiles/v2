import { PencilSquare } from "@medusajs/icons"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Notification } from "../../hooks/api/notifications"
import { CommonField, CommonSection } from "../common/section-views"

type NotificationGeneralSectionProps = {
  notification: Notification
}

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

const getStatusBadgeColor = (status?: string | null) => {
  switch (status) {
    case "success":
      return "green" as const
    case "failure":
      return "red" as const
    case "pending":
      return "orange" as const
    default:
      return "grey" as const
  }
}

export const NotificationGeneralSection = ({
  notification,
}: NotificationGeneralSectionProps) => {
  const { t } = useTranslation()

  const canEditRetry =
    notification.channel === "email" && notification.status === "failure"

  const actionGroups = useMemo(
    () => [
      {
        actions: [
          {
            label: t("actions.edit"),
            icon: <PencilSquare />,
            to: `edit`,
            disabled: !canEditRetry,
            disabledTooltip: canEditRetry
              ? undefined
              : "Only email notifications that have failed can be edited and retried",
          },
        ],
      },
    ],
    [canEditRetry, t]
  )

  const fields: CommonField[] = useMemo(
    () => [
      {
        label: "ID",
        value: notification.id,
      },
      {
        label: "Channel",
        value: notification.channel || "-",
      },
      {
        label: "Status",
        badge: {
          value: notification.status || "-",
          color: getStatusBadgeColor(notification.status),
        },
      },
      {
        label: "To",
        value: notification.to || "-",
      },
      {
        label: "Template",
        value: notification.template || "-",
      },
      {
        label: "Provider",
        value: notification.provider_id || "-",
      },
      {
        label: "External ID",
        value: notification.external_id || "-",
      },
      {
        label: "Original Notification",
        value: notification.original_notification_id || "-",
      },
      {
        label: "Created",
        value: formatDateTime(notification.created_at),
      },
      {
        label: "Updated",
        value: formatDateTime(notification.updated_at),
      },
    ],
    [notification]
  )

  return (
    <CommonSection
      title={t("notifications.general", "General")}
      description={t(
        "notifications.generalDescription",
        "Basic details about this notification."
      )}
      fields={fields}
      actionGroups={actionGroups}
    />
  )
}
