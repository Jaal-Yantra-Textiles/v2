import {
  BellAlert,
  BellAlertDone,
  InformationCircleSolid,
} from "@medusajs/icons"
import { clx, Drawer, Heading, IconButton, Text } from "@medusajs/ui"
import { formatDistance } from "date-fns"
import { TFunction } from "i18next"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  notificationQueryKeys,
  PartnerNotification,
  PartnerNotificationListParams,
  PartnerNotificationListResponse,
  useMarkAllPartnerNotificationsRead,
  usePartnerNotificationsUnreadCount,
} from "../../../hooks/api"
import { sdk } from "../../../lib/client"
import { FilePreview } from "../../common/file-preview"
import { InfiniteList } from "../../common/infinite-list"

interface NotificationData {
  title: string
  description?: string
  url?: string
  file?: {
    filename?: string
    url?: string
    mimeType?: string
  }
}

const buildListPath = (query?: PartnerNotificationListParams): string => {
  if (!query) return "/partners/notifications"
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `/partners/notifications?${s}` : "/partners/notifications"
}

export const Notifications = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // Server is source of truth for read state. Poll the cheap count
  // endpoint while the drawer is closed; pause when open since the
  // mark-all-read mutation will reset it on close.
  const { data: unreadData } = usePartnerNotificationsUnreadCount({
    refetchInterval: open ? false : 60_000,
  })
  const hasUnread = (unreadData?.unread_count ?? 0) > 0

  const { mutate: markAllRead } = useMarkAllPartnerNotificationsRead()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  const handleOnOpen = (shouldOpen: boolean) => {
    if (shouldOpen) {
      // Bump the server's last-seen timestamp so the badge clears across
      // tabs/sessions, not just this browser's localStorage.
      markAllRead()
    }
    setOpen(shouldOpen)
  }

  return (
    <Drawer open={open} onOpenChange={handleOnOpen}>
      <Drawer.Trigger asChild>
        <IconButton
          variant="transparent"
          size="small"
          className="text-ui-fg-muted hover:text-ui-fg-subtle"
        >
          {hasUnread ? <BellAlertDone /> : <BellAlert />}
        </IconButton>
      </Drawer.Trigger>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title asChild>
            <Heading>{t("notifications.domain")}</Heading>
          </Drawer.Title>
          <Drawer.Description className="sr-only">
            {t("notifications.accessibility.description")}
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="overflow-y-auto px-0">
          <InfiniteList<
            PartnerNotificationListResponse,
            PartnerNotification,
            PartnerNotificationListParams
          >
            responseKey="notifications"
            queryKey={notificationQueryKeys.all}
            queryFn={(params) =>
              sdk.client.fetch<PartnerNotificationListResponse>(
                buildListPath(params),
                { method: "GET" },
              )
            }
            queryOptions={{ enabled: open }}
            renderEmpty={() => <NotificationsEmptyState t={t} />}
            renderItem={(notification) => (
              <Notification
                key={notification.id}
                notification={notification}
                unread={notification.is_unread}
              />
            )}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

const Notification = ({
  notification,
  unread,
}: {
  notification: PartnerNotification
  unread?: boolean
}) => {
  const data = notification.data as unknown as NotificationData | undefined

  // We need at least the title to render a notification in the feed
  if (!data?.title) {
    return null
  }

  return (
    <div className="relative flex items-start justify-center gap-3 border-b p-6">
      <div className="text-ui-fg-muted flex size-5 items-center justify-center">
        <InformationCircleSolid />
      </div>
      <div className="flex w-full flex-col gap-y-3">
        <div className="flex flex-col">
          <div className="flex items-center justify-between">
            <Text size="small" leading="compact" weight="plus">
              {data.title}
            </Text>
            <div className="align-center flex items-center justify-center gap-2">
              <Text
                as="span"
                className={clx("text-ui-fg-subtle", {
                  "text-ui-fg-base": unread,
                })}
                size="small"
                leading="compact"
                weight="plus"
              >
                {formatDistance(notification.created_at, new Date(), {
                  addSuffix: true,
                })}
              </Text>
              {unread && (
                <div
                  className="bg-ui-bg-interactive h-2 w-2 rounded"
                  role="status"
                />
              )}
            </div>
          </div>
          {!!data.description && (
            <Text
              className="text-ui-fg-subtle whitespace-pre-line"
              size="small"
            >
              {data.description}
            </Text>
          )}
        </div>
        {!!data?.file?.url && (
          <FilePreview
            filename={data.file.filename ?? ""}
            url={data.file.url}
            hideThumbnail
          />
        )}
      </div>
    </div>
  )
}

const NotificationsEmptyState = ({ t }: { t: TFunction }) => {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <BellAlertDone />
      <Text size="small" leading="compact" weight="plus" className="mt-3">
        {t("notifications.emptyState.title")}
      </Text>
      <Text
        size="small"
        className="text-ui-fg-muted mt-1 max-w-[294px] text-center"
      >
        {t("notifications.emptyState.description")}
      </Text>
    </div>
  )
}
