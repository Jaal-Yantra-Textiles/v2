import { LoaderFunctionArgs, UIMatch, useLoaderData, useParams } from "react-router-dom"
import { usePartner } from "../../../hooks/api/partners-admin"
import { Toaster } from "@medusajs/ui"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { PartnerGeneralSection } from "../../../components/partners/partner-general-section"
import { PartnerAdminsSection } from "../../../components/partners/partner-admins-section"
import { PartnerLedgerSection } from "../../../components/partners/partner-ledger-section"
import { PartnerCreditsSection } from "../../../components/partners/partner-credits-section"
import { PartnerTasksSection } from "../../../components/partners/partner-tasks-section"
import { PartnerFeedbacksSection } from "../../../components/partners/partner-feedbacks-section"
import { PartnerStorefrontSection } from "../../../components/partners/partner-storefront-section"
import { PartnerInspectionSection } from "../../../components/partners/partner-inspection-section"
import { PartnerSubscriptionSection } from "../../../components/partners/partner-subscription-section"
import { PartnerPeopleSection } from "../../../components/partners/partner-people-section"
import { PartnerWhatsAppSection } from "../../../components/partners/partner-whatsapp-section"
import { PartnerEmailVerificationSection } from "../../../components/partners/partner-email-verification-section"
import { PartnerTransactionFeesSection } from "../../../components/partners/partner-transaction-fees-section"
import type { AdminPartner } from "../../../hooks/api/partners-admin"
import { partnerLoader } from "./loader"

const PartnerDetailPage = () => {
  const { id } = useParams()
  const initialData = useLoaderData() as Awaited<{ partner: AdminPartner }>
  const { partner, isPending: isLoading, isError, error } = usePartner(
    id!,
    ["*", "admins.*", "internal_payments.*", "internal_payments.paid_to.*"],
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
          <PartnerInspectionSection partnerId={partner.id} />
          <PartnerTasksSection partnerId={partner.id} />
          <PartnerStorefrontSection partnerId={partner.id} />
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          <PartnerWhatsAppSection
            partnerId={partner.id}
            partnerName={partner.name}
            whatsappNumber={partner.whatsapp_number}
            whatsappVerified={partner.whatsapp_verified}
          />
          <PartnerEmailVerificationSection
            partnerId={partner.id}
            partnerName={partner.name}
          />
          <PartnerSubscriptionSection partnerId={partner.id} />
          <PartnerPeopleSection partnerId={partner.id} />
          <PartnerAdminsSection partnerId={partner.id} admins={partner.admins || []} />
          {/* ONE panel over both money records (#1612). It used to be two —
              `internal_payments` above, submissions below — which since #1638
              means each showed half the money with nothing saying so. */}
          <PartnerLedgerSection partnerId={partner.id} />
          {/* Directly beneath the ledger, because the two are read together:
              the ledger says what is still owed, and this says how much of it
              money already in the partner's hands could discharge (#1712). */}
          <PartnerCreditsSection partnerId={partner.id} />
          <PartnerTransactionFeesSection partnerId={partner.id} />
          <PartnerFeedbacksSection partnerId={partner.id} />
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
