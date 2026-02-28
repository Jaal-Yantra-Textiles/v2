import { Badge, Container, Heading, Text, toast } from "@medusajs/ui";
import { Plus, Check } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import { useUpdatePayment } from "../../hooks/api/payments";
import { useState } from "react";

type InventoryOrderPaymentsSectionProps = {
  inventoryOrder: any;
};

const PaymentRow = ({ p }: { p: any }) => {
  const { mutateAsync, isPending } = useUpdatePayment(p.id);
  const [loading, setLoading] = useState(false);

  const onMarkCompleted = async () => {
    try {
      setLoading(true);
      await mutateAsync({ status: "Completed" });
      toast.success("Payment marked as Completed");
    } catch (e: any) {
      toast.error(e?.message || "Failed to update payment");
    } finally {
      setLoading(false);
    }
  };

  const isCompleted = p?.status === "Completed";

  const handleClick = () => {
    if (isCompleted || loading || isPending) return;
    void onMarkCompleted();
  };

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-x-3">
        <Badge size="2xsmall">{p.status}</Badge>
        <Text size="small" className="text-ui-fg-base">{p.payment_type}</Text>
        <Text size="small" className="text-ui-fg-subtle">{new Date(p.payment_date).toLocaleDateString()}</Text>
      </div>
      <div className="flex items-center gap-x-3">
        <Text size="small" className="text-ui-fg-base font-medium">₹ {p.amount ?? p?.raw_amount?.value}</Text>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: isCompleted ? "Already Completed" : "Mark as Completed",
                  icon: <Check />,
                  onClick: handleClick,
                  disabled: isCompleted || loading || isPending,
                },
              ],
            },
          ]}
        />
      </div>
    </div>
  );
};

export const InventoryOrderPaymentsSection = ({ inventoryOrder }: InventoryOrderPaymentsSectionProps) => {
  const payments = inventoryOrder?.internal_payments || [];
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Payments</Heading>
          <Badge size="2xsmall" className="ml-2">{payments.length || 0}</Badge>
        </div>
        <div className="flex items-center gap-x-4">
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Add Payment",
                    icon: <Plus />,
                    to: `add-payments`,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      {payments.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle px-6 py-8 border-ui-border-base text-center">No payments to show yet.</Text>
        </div>
      ) : (
        <div className="px-6 py-2 flex flex-col divide-y">
          {payments.map((p: any) => (
            <PaymentRow key={p.id} p={p} />
          ))}
        </div>
      )}
    </Container>
  );
};
