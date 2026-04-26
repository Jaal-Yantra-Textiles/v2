import { CreateGoogleMerchantAccount } from "../../../../components/creates/create-google-merchant-account"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

const CreateGoogleMerchantPage = () => {
  return (
    <RouteFocusModal prev="/settings/google-merchant">
      <CreateGoogleMerchantAccount />
    </RouteFocusModal>
  )
}

export default CreateGoogleMerchantPage
