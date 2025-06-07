import { Heading } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"

import { usePage } from "../../../../../../hooks/api/pages"
import { RouteDrawer } from "../../../../../../components/modal/route-drawer/route-drawer"
import { SendBlogSubscriptionForm } from "./components/send-blog-subscription-form"

const SendBlogSubscription = () => {
  const { id: websiteId, pageId } = useParams()
  const { t } = useTranslation()

  const { page, isLoading, isError, error } = usePage(websiteId!, pageId!)

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("blogs.send.header", { defaultValue: "Send Blog to Subscribers" })}</Heading>
        </RouteDrawer.Title>
      </RouteDrawer.Header>
      
      {!isLoading && page && (
        <SendBlogSubscriptionForm page={page} websiteId={websiteId!} pageId={pageId!} />
      )}
    </RouteDrawer>
  )
}

export default SendBlogSubscription
