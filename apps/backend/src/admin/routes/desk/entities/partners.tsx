import PartnersPage from "../../partners/page"
import PartnersCreatePage from "../../partners/create/page"
import PartnerDetailPage from "../../partners/[id]/page"
import PartnerAddPaymentMethod from "../../partners/[id]/@add-payment-method/page"
import PartnerAddPayments from "../../partners/[id]/@add-payments/page"
import PartnerAddFeedback from "../../partners/[id]/@add-feedback/page"
import PartnerTasksViewCanvas from "../../partners/[id]/@tasks/view-canvas/page"
import PartnerTasksNew from "../../partners/[id]/@tasks/new/page"
import PartnerFeedbacksEdit from "../../partners/[id]/@feedbacks/edit/page"
import PartnerMetadataEdit from "../../partners/[id]/@metadata/edit/page"
import type { EntityPanelConfig } from "../EntityPanel"

export const partnersEntityConfig: EntityPanelConfig = {
  initialPath: "/partners",
  routes: [
    {
      path: "/partners",
      element: <PartnersPage />,
      children: [
        { path: "create", element: <PartnersCreatePage /> },
      ],
    },
    {
      path: "/partners/:id",
      element: <PartnerDetailPage />,
      children: [
        { path: "add-payment-method", element: <PartnerAddPaymentMethod /> },
        { path: "add-payments", element: <PartnerAddPayments /> },
        { path: "add-feedback", element: <PartnerAddFeedback /> },
        { path: "tasks/view-canvas", element: <PartnerTasksViewCanvas /> },
        { path: "tasks/new", element: <PartnerTasksNew /> },
        { path: "feedbacks/edit", element: <PartnerFeedbacksEdit /> },
        { path: "metadata/edit", element: <PartnerMetadataEdit /> },
      ],
    },
  ],
}
