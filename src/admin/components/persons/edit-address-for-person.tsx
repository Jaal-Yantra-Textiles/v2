import { useTranslation } from "react-i18next";
import { FieldValues } from "react-hook-form";
import { useUpdatePersonAddress } from "../../hooks/api/person-addresses";
import { AddressDetails, AddressInput } from "../../hooks/api/personandtype";
import { DynamicForm, FieldConfig } from "../common/dynamic-form";
import { toast } from "@medusajs/ui";
import { useRouteModal } from "../modal/use-route-modal";

interface EditAddressForPersonFormProps {
  personId: string;
  address: AddressDetails;
}

export const EditAddressForPersonForm = ({ personId, address }: EditAddressForPersonFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdatePersonAddress(personId, address.id);

  const fields: FieldConfig<AddressInput>[] = [
    {
      name: "street",
      label: t("fields.street"),
      type: "text",
    },
    {
      name: "city",
      label: t("fields.city"),
      type: "text",
    },
    {
      name: "state",
      label: t("fields.state"),
      type: "text",
    },
    {
      name: "postal_code",
      label: t("fields.postalCode"),
      type: "text",
    },
    {
      name: "country",
      label: t("fields.country"),
      type: "text",
    },
    {
        name: "latitude",
        label: t("fields.latitude"),
        type: "number",
    },
    {
        name: "longitude",
        label: t("fields.longitude"),
        type: "number",
    }
  ];

  const handleSubmit = async (data: FieldValues) => {
    try {
      await mutateAsync(data as AddressInput);
      toast.success(t("persons.address.toast.updated"));
      handleSuccess();
    } catch (e) {
      const error = e as Error;
      toast.error(error.message);
    }
  };

  return (
    <DynamicForm
      fields={fields}
      defaultValues={{
        street: address.street,
        city: address.city,
        state: address.state,
        postal_code: address.postal_code,
        country: address.country,
        latitude: address.latitude,
        longitude: address.longitude,
      }}
      onSubmit={handleSubmit}
      isPending={isPending}
    />
  );
};
