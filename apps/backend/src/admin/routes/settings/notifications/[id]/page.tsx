import { UIMatch, useLoaderData, useParams, LoaderFunctionArgs } from "react-router-dom"

import { SingleColumnPage } from "../../../../components/pages/single-column-pages"
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton"
import { NotificationGeneralSection } from "../../../../components/notifications/notification-general-section"
import { useNotification } from "../../../../hooks/api/notifications"
import { notificationLoader } from "./loader"

import { Toaster } from '@medusajs/ui'


const NotificationDetailPage = () => {
  const { id } = useParams()
  const initialData = useLoaderData() as Awaited<ReturnType<typeof notificationLoader>>

  const { notification, isLoading, isError } = useNotification(id!, {
    initialData, 
  })

  if (isLoading || !notification) {
    return <SingleColumnPageSkeleton sections={1} showJSON showMetadata />
  }

  if (isError) {
    throw new Error("Failed to load notification")
  }

  return (
    <SingleColumnPage data={notification} hasOutlet showJSON showMetadata>
        <Toaster/>
      <NotificationGeneralSection notification={notification} />
    </SingleColumnPage>
  )
}

export default NotificationDetailPage

export async function loader({ params }: LoaderFunctionArgs) {
  return notificationLoader({ params })
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return id
  },
}
