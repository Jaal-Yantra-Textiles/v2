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
  payment_terms: "on_receipt" | "advance";
  advance_percent?: number;
}

export const EditInventoryOrderForm = ({ order }: EditInventoryOrderFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();

  const { mutateAsync, isPending } = useUpdateInventoryOrder(order.id);

  const fields: FieldConfig<Partial<EditInventoryOrderFormData>>[] = [
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
    {
      name: "payment_terms",
      label: "Payment terms",
      type: "select",
      required: true,
      options: [
        { value: "on_receipt", label: "Pay on receipt" },
        { value: "advance", label: "Advance" },
      ],
      hint: "Pay on receipt: the supplier can be paid only once goods are received. Advance: part or all can be paid before delivery.",
    },
    {
      name: "advance_percent",
      label: "Advance %",
      type: "number",
      hint: "1–100. Only used with Advance — e.g. 100 for full payment before delivery.",
    },
  ];

  const handleSubmit = async (data: EditInventoryOrderFormData) => {
    await mutateAsync(
      {
        order_date: data.order_date.toISOString(),
        expected_delivery_date: data.expected_delivery_date.toISOString(),
        // #2315 — a percent is only meaningful with advance terms; the API
        // refuses one on a pay-on-receipt order, so clear it there.
        payment_terms: data.payment_terms,
        advance_percent:
          data.payment_terms === "advance" ? data.advance_percent ?? null : null,
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
    payment_terms: order.payment_terms ?? "on_receipt",
    advance_percent: order.advance_percent ?? undefined,
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
