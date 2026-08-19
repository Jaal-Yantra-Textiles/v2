import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { ProductSpecEditForm } from "../../../../components/forms/product-spec/product-spec-edit-form"

/**
 * #1349 — `/products/:id/spec`. Same shape as `link-design`: the page is the
 * modal shell, the form is its child (and the only thing allowed to call
 * `useRouteModal`). Closing returns to the product page via the modal's
 * default `prev` of "..".
 */
export default function ProductSpecPage() {
  return (
    <RouteFocusModal>
      <ProductSpecEditForm />
    </RouteFocusModal>
  )
}
