import PersonsPage from "../../persons/page"
import PersonsCreate from "../../persons/create/page"
import PersonsImport from "../../persons/@import/page"
import PersonsBackfillGeocodes from "../../persons/@backfill-geocodes/page"
import PersonsMap from "../../persons/map/page"
import PersonDetailPage from "../../persons/[id]/page"
import PersonEdit from "../../persons/[id]/@edit/page"
import PersonAddAddress from "../../persons/[id]/@add-address/page"
import PersonAddContact from "../../persons/[id]/@add-contact/page"
import PersonAddPaymentMethod from "../../persons/[id]/@add-payment-method/page"
import PersonAddPayment from "../../persons/[id]/@add-payment/page"
import PersonAddTypes from "../../persons/[id]/@add-types/page"
import PersonEditAddress from "../../persons/[id]/@edit-address/[addressId]/page"
import PersonEditContact from "../../persons/[id]/@edit-contact/[contactId]/page"
import PersonGeocode from "../../persons/[id]/@geocode/page"
import PersonMetadataEdit from "../../persons/[id]/@metadata/edit/page"
import PersonSendAgreement from "../../persons/[id]/@sendAgreement/page"
import PersonShowAgreements from "../../persons/[id]/@showAgreements/page"
import PersonAddNote from "../../persons/[id]/addnote/page"
import type { EntityPanelConfig } from "../EntityPanel"

/**
 * Persons (People) entity wiring. List + map + create + the two list-level
 * overlays, plus the person detail page and its overlays. Paths mirror
 * Medusa's @-folder convention without the `@` prefix.
 */
export const personsEntityConfig: EntityPanelConfig = {
  initialPath: "/persons",
  routes: [
    {
      path: "/persons",
      element: <PersonsPage />,
      children: [
        { path: "create", element: <PersonsCreate /> },
        { path: "import", element: <PersonsImport /> },
        { path: "backfill-geocodes", element: <PersonsBackfillGeocodes /> },
      ],
    },
    { path: "/persons/map", element: <PersonsMap /> },
    {
      path: "/persons/:id",
      element: <PersonDetailPage />,
      children: [
        { path: "edit", element: <PersonEdit /> },
        { path: "add-address", element: <PersonAddAddress /> },
        { path: "add-contact", element: <PersonAddContact /> },
        { path: "add-payment-method", element: <PersonAddPaymentMethod /> },
        { path: "add-payment", element: <PersonAddPayment /> },
        { path: "add-types", element: <PersonAddTypes /> },
        { path: "edit-address/:addressId", element: <PersonEditAddress /> },
        { path: "edit-contact/:contactId", element: <PersonEditContact /> },
        { path: "geocode", element: <PersonGeocode /> },
        { path: "metadata/edit", element: <PersonMetadataEdit /> },
        { path: "sendAgreement", element: <PersonSendAgreement /> },
        { path: "showAgreements", element: <PersonShowAgreements /> },
        { path: "addnote", element: <PersonAddNote /> },
      ],
    },
  ],
}
