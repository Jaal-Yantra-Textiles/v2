import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { usePersonAddresses } from "../../../../../hooks/api/person-addresses";
import { AddressDetails } from "../../../../../hooks/api/personandtype";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { Spinner } from "../../../../../components/ui/ios-spinner";
import { EditAddressForPersonForm } from "../../../../../components/persons/edit-address-for-person";

export default function EditAddressPage() {
  const { id, addressId } = useParams();
  const { t } = useTranslation();
  const { addresses, isPending } = usePersonAddresses(id!);

  const address = addresses.find((a: AddressDetails) => a.id === addressId);

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("persons.address.edit.title")}</Heading>
      </RouteDrawer.Header>
      {isPending && (
        <div className="flex items-center justify-center p-8">
          <Spinner />
        </div>
      )}
      {address && <EditAddressForPersonForm personId={id!} address={address} />}
    </RouteDrawer>
  );
}
