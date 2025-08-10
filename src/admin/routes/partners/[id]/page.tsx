import { LoaderFunctionArgs, UIMatch, useLoaderData, useParams } from "react-router-dom"
import { usePartner } from "../../../hooks/api/partners-admin"
import { Toaster } from "@medusajs/ui"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { PartnerGeneralSection } from "../../../components/partners/partner-general-section"
import { PartnerAdminsSection } from "../../../components/partners/partner-admins-section"
import type { AdminPartner } from "../../../hooks/api/partners-admin"
import { partnerLoader } from "./loader"

const PartnerDetailPage = () => {
  const { id } = useParams()
  const initialData = useLoaderData() as Awaited<{ partner: AdminPartner }>
  const { partner, isPending: isLoading, isError, error } = usePartner(
    id!,
    ["*", "admins.*"],
    { initialData },
  ) as any

  if (isLoading || !partner) {
    return (
      <TwoColumnPageSkeleton mainSections={2} sidebarSections={1} showJSON showMetadata />
    )
  }

  if (isError) {
    throw error
  }

  return (
    <>
      <Toaster />
      <TwoColumnPage data={partner} hasOutlet={true} showJSON showMetadata>
        <TwoColumnPage.Main>
          <PartnerGeneralSection partner={partner} />
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          <PartnerAdminsSection admins={partner.admins || []} />
        </TwoColumnPage.Sidebar>
      </TwoColumnPage>
    </>
  )
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return `${id}`
  },
}

export async function loader({ params }: LoaderFunctionArgs) {
  return await partnerLoader({ params })
}

export default PartnerDetailPage
