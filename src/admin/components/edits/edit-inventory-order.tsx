import { DatePicker } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { DynamicForm, FieldConfig } from "../common/dynamic-form";
import { useUpdateInventoryOrder } from "../../hooks/api/inventory-orders";
import type { AdminInventoryOrder } from "../../hooks/api/inventory-orders";
import { useRouteModal } from "../modal/use-route-modal";

interface EditInventoryOrderFormProps {
  order: AdminInventoryOrder;
}

interface EditInventoryOrderFormData {
  order_date: Date;
  expected_delivery_date: Date;
}

export const EditInventoryOrderForm = ({ order }: EditInventoryOrderFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();

  const { mutateAsync, isPending } = useUpdateInventoryOrder(order.id);

  const fields: FieldConfig<EditInventoryOrderFormData>[] = [
    {
      name: "order_date",
      label: t("fields.orderDate"),
      type: "custom",
      required: true,
      customComponent: DatePicker,
      customProps: {
        placeholder: t("placeholders.selectDate"),
      },
    },
    {
      name: "expected_delivery_date",
      label: t("fields.expectedDeliveryDate"),
      type: "custom",
      required: true,
      customComponent: DatePicker,
      customProps: {
        placeholder: t("placeholders.selectDate"),
      },
    },
  ];

  const handleSubmit = async (data: EditInventoryOrderFormData) => {
    await mutateAsync(
      {
        order_date: data.order_date.toISOString(),
        expected_delivery_date: data.expected_delivery_date.toISOString(),
      },
      {
        onSuccess: () => {
          handleSuccess();
        },
      }
    );
  };

  const initialValues: Partial<EditInventoryOrderFormData> = {
    order_date: new Date(order.order_date),
    expected_delivery_date: new Date(order.expected_delivery_date),
  };

  // Do not render if order is not pending (handled by parent component)
  return (
    <DynamicForm
      fields={fields}
      defaultValues={initialValues}
      onSubmit={handleSubmit}
      isPending={isPending}
    />
  );
};
