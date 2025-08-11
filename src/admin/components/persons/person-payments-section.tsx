import { Badge, Container, Heading, Text } from "@medusajs/ui";
import { Plus } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";

type PersonPaymentsSectionProps = {
  person: any;
};

export const PersonPaymentsSection = ({ person }: PersonPaymentsSectionProps) => {
  const payments = person?.internal_payments || [];
  return (
    <Container className="divide-y p-0" data-person-id={person?.id}>
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
                    to: `add-payment`,
                  },
                  {
                    label: "Add Payment Method",
                    icon: <Plus />,
                    to: `add-payment-method`,
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
            <div key={p.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-x-3">
                <Badge size="2xsmall">{p.status}</Badge>
                <Text size="small" className="text-ui-fg-base">{p.payment_type}</Text>
                <Text size="small" className="text-ui-fg-subtle">{new Date(p.payment_date).toLocaleDateString()}</Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-base font-medium">₹ {p.amount ?? p?.raw_amount?.value}</Text>
              </div>
            </div>
          ))}
        </div>
      )}
    </Container>
  );
};
