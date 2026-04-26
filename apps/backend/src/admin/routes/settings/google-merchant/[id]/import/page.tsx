import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../../../../components/modal/route-focus-modal"
import { ImportGoogleMerchantProducts } from "../../../../../components/google-merchant/import-google-merchant-products"

const ImportGoogleMerchantPage = () => {
  const { id } = useParams<{ id: string }>()
  return (
    <RouteFocusModal prev={`/settings/google-merchant/${id}`}>
      <ImportGoogleMerchantProducts />
    </RouteFocusModal>
  )
}

export default ImportGoogleMerchantPage
