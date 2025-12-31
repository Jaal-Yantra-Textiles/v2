import { Button, Heading, Text, toast } from "@medusajs/ui"
import { JsonEditor, monoDarkTheme, monoLightTheme } from "json-edit-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer"
import { useDarkMode } from "../../../../../hooks/use-dark-mode"
import {
  failedNotificationsQueryKeys,
  Notification,
  useNotification,
  useRetryFailedEmail,
} from "../../../../../hooks/api/notifications"

const EditNotificationDrawerPage = () => {
  const { id } = useParams()
  const isDarkMode = useDarkMode()
  const queryClient = useQueryClient()

  const { notification, isLoading } = useNotification(id!)
  const { mutateAsync, isPending } = useRetryFailedEmail()

  const lightTheme = useMemo(
    () => [
      monoLightTheme,
      {
        styles: {
          container: {
            backgroundColor: "#ffffff",
          },
          input: {
            color: "#292929",
          },
          property: "#292929",
          string: "rgb(203, 75, 22)",
          number: "rgb(38, 139, 210)",
        },
      },
    ],
    []
  )

  const darkTheme = useMemo(
    () => [
      monoDarkTheme,
      {
        styles: {
          container: {
            backgroundColor: "#1a1a1a",
          },
          input: {
            color: "#e0e0e0",
          },
          property: "#e0e0e0",
          string: "rgb(255, 160, 122)",
          number: "rgb(100, 200, 255)",
        },
      },
    ],
    []
  )

  const cloneData = (data: unknown) => {
    if (!data) {
      return {}
    }

    try {
      return JSON.parse(JSON.stringify(data))
    } catch {
      return {}
    }
  }

  const [editedData, setEditedData] = useState<Record<string, any>>({})
  const [isDirty, setIsDirty] = useState(false)
  const lastNotificationIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!notification) {
      return
    }

    const isNewNotification = lastNotificationIdRef.current !== notification.id

    if (isNewNotification) {
      lastNotificationIdRef.current = notification.id
      setIsDirty(false)
      setEditedData(cloneData(notification.data) as Record<string, any>)
      return
    }

    if (!isDirty) {
      setEditedData(cloneData(notification.data) as Record<string, any>)
    }
  }, [notification, isDirty])

  const handleRetry = async (n: Notification) => {
    if (n.channel !== "email" || n.status !== "failure") {
      toast.info("Only email notifications that have failed can be retried")
      return
    }

    await mutateAsync({
      notificationId: n.id,
      to: n.to,
      template: n.template,
      data: editedData,
    })

    toast.success("Retry triggered")
    queryClient.invalidateQueries({
      queryKey: failedNotificationsQueryKeys.lists(),
    })
    queryClient.invalidateQueries({
      queryKey: failedNotificationsQueryKeys.detail(n.id),
    })
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Edit Notification Data</Heading>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-1 flex-col overflow-hidden">
        {isLoading || !notification ? (
          <Text className="text-ui-fg-subtle">Loading...</Text>
        ) : (
          <div className="flex flex-1 flex-col gap-y-4 min-h-0">
            <div className="space-y-1">
              <Text size="small" className="text-ui-fg-subtle">
                {notification.template}
              </Text>
              <Text size="small" className="text-ui-fg-subtle">
                To: {notification.to}
              </Text>
              <Text size="small" className="text-ui-fg-subtle">
                Status: {notification.status || "-"}
              </Text>
            </div>

            <div className="flex-1 min-h-0 w-full border border-ui-border-base rounded-md overflow-hidden">
              <div className="h-full overflow-y-auto">
                <JsonEditor
                  data={editedData}
                  setData={(newData) => {
                    setIsDirty(true)
                    setEditedData(newData as Record<string, any>)
                  }}
                  theme={isDarkMode ? darkTheme : lightTheme}
                />
              </div>
            </div>
          </div>
        )}
      </RouteDrawer.Body>
      <RouteDrawer.Footer className="bg-ui-bg-base border-t border-ui-border-base">
        <div className="flex items-center justify-end gap-x-2">
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              setIsDirty(false)
              setEditedData(cloneData(notification?.data) as Record<string, any>)
            }}
            disabled={isPending}
          >
            Reset
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => (notification ? handleRetry(notification) : undefined)}
            isLoading={isPending}
          >
            Retry with Changes
          </Button>
        </div>
      </RouteDrawer.Footer>
    </RouteDrawer>
  )
}

export default EditNotificationDrawerPage
