import { Badge, Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui";
import { Plus, Check, DocumentText } from "@medusajs/icons";
import { Link } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";
import { useUpdatePayment } from "../../hooks/api/payments";
import {
  useInventoryOrderPayments,
  type InventoryOrderPayout,
} from "../../hooks/api/inventory-orders";
import { describePaymentLine } from "../../lib/payment-line-source";
import {
  paymentSubmissionStatusColor,
  paymentSubmissionStatusLabel,
} from "../../lib/payment-submission-status";
import { useState } from "react";

type InventoryOrderPaymentsSectionProps = {
  inventoryOrder: any;
};

const money = (amount: number | null | undefined, currency?: string | null) =>
  `${(currency || "inr").toUpperCase()} ${Number(amount ?? 0).toLocaleString()}`;

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

  const attachments: any[] = Array.isArray(p?.attachments) ? p.attachments : [];

  return (
    <div className="flex flex-col gap-y-2 py-3">
      <div className="flex items-center justify-between">
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
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          {attachments.map((a: any) => (
            <a
              key={a.id || a.file_id}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-x-1 rounded-md border border-ui-border-base bg-ui-bg-subtle px-2 py-1 text-ui-fg-subtle transition-colors hover:bg-ui-bg-base hover:text-ui-fg-base"
            >
              <DocumentText className="text-ui-fg-muted" />
              <Text size="xsmall" className="max-w-[180px] truncate">
                {a.filename || a.file_id || "attachment"}
              </Text>
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * One partner payout that names THIS order.
 *
 * Shown at every status, not only once approved — a Pending payout is the
 * answer to "have we billed for this yet", and it is the status the order most
 * needs to show. `amount` is what this order contributes, which is not the
 * submission total when the payout covers several orders.
 */
const PayoutRow = ({ payout }: { payout: InventoryOrderPayout }) => {
  const source = describePaymentLine(payout);
  const partial =
    payout.submission_total != null &&
    Number(payout.submission_total) !== Number(payout.amount);

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex flex-col gap-y-1">
        <div className="flex items-center gap-x-2">
          <StatusBadge color={paymentSubmissionStatusColor(payout.submission_status)}>
            {paymentSubmissionStatusLabel(payout.submission_status)}
          </StatusBadge>
          <Text size="small" className="text-ui-fg-base">{source.label}</Text>
        </div>
        <Link
          to={`/payment-submissions/${payout.submission_id}`}
          className="text-ui-fg-interactive font-mono text-xs hover:underline"
        >
          {payout.submission_id}
        </Link>
      </div>
      <div className="flex flex-col items-end gap-y-1">
        <Text size="small" className="text-ui-fg-base font-medium">
          {money(payout.amount, payout.currency)}
        </Text>
        {partial && (
          <Text size="xsmall" className="text-ui-fg-subtle">
            of {money(payout.submission_total, payout.currency)} on this payout
          </Text>
        )}
      </div>
    </div>
  );
};

export const InventoryOrderPaymentsSection = ({ inventoryOrder }: InventoryOrderPaymentsSectionProps) => {
  const orderId = inventoryOrder?.id;
  const { payouts, payments: linkedPayments, totals, isLoading, isError } =
    useInventoryOrderPayments(orderId, { enabled: !!orderId });

  /**
   * 🔴 The recorded payments come from the route, not from
   * `inventoryOrder.internal_payments`. The link behind that field is written
   * only when a payout is APPROVED, and only since #1621 — reading it alone is
   * what made an order with a Pending payout say "no payments to show yet".
   */
  const payments: any[] = linkedPayments || [];

  const payoutList = payouts || [];
  const total = payoutList.length + payments.length;

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Payments</Heading>
          <Badge size="2xsmall" className="ml-2">{total}</Badge>
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

      {isError && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Could not load what this order has been billed for. The recorded
            payments below, if any, are still accurate.
          </Text>
        </div>
      )}

      {payoutList.length > 0 && (
        <div className="px-6 py-2 flex flex-col divide-y">
          <div className="flex items-center justify-between py-2">
            <Text size="small" weight="plus" className="text-ui-fg-subtle">
              Partner payouts for this order
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              {money(totals?.paid, payoutList[0]?.currency)} paid of{" "}
              {money(totals?.billed, payoutList[0]?.currency)} billed
            </Text>
          </div>
          {payoutList.map((p) => (
            <PayoutRow key={p.line_id} payout={p} />
          ))}
        </div>
      )}

      {payments.length > 0 && (
        <div className="px-6 py-2 flex flex-col divide-y">
          <Text size="small" weight="plus" className="text-ui-fg-subtle py-2">
            Recorded payments
          </Text>
          {payments.map((p: any) => (
            <PaymentRow key={p.id} p={p} />
          ))}
        </div>
      )}

      {!isLoading && total === 0 && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle px-6 py-8 border-ui-border-base text-center">
            Nothing has been billed against this order yet.
          </Text>
        </div>
      )}
    </Container>
  );
};
