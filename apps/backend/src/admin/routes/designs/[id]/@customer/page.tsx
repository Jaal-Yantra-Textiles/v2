import { useParams } from "react-router-dom"

import { DesignCustomerForm } from "../../../../components/designs/design-customer-form"
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { useDesign } from "../../../../hooks/api/designs"

/**
 * `/designs/:id/customer` — whose design this is (#2111).
 *
 * A Drawer, not a FocusModal: the design already exists and only its customer
 * is being changed. The current customer is read from the design the detail
 * loader already fetched (`customers.*` is in DESIGN_DETAIL_FIELDS), so it is
 * right on first paint rather than after a search.
 */
const DesignCustomerPage = () => {
  const { id } = useParams()
  const { design } = useDesign(id!)

  const customer = Array.isArray((design as any)?.customers)
    ? (design as any).customers.filter(Boolean)[0] ?? null
    : null

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <span>Customer</span>
        </RouteDrawer.Title>
        <RouteDrawer.Description asChild>
          <span className="sr-only">
            Choose who updates about this design are sent to.
          </span>
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <DesignCustomerForm designId={id!} customer={customer} />
    </RouteDrawer>
  )
}

export default DesignCustomerPage
