import { useParams } from "react-router-dom";

import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import { AddPartnerPaymentMethodForm } from "../../../../components/creates/create-partner-payment-method";

/**
 * The route shell. The form itself lives in `components/creates` so the
 * partner graph opens the same one (#1856) — this page owns only the drawer.
 */
const AddPaymentMethodForPartner = () => {
  const { id } = useParams();

  return (
    <RouteDrawer>
      <AddPartnerPaymentMethodForm partnerId={id!} />
    </RouteDrawer>
  );
};

export default AddPaymentMethodForPartner;
