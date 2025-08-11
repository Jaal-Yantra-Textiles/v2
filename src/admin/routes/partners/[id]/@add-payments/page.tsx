import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import { Button, Input, Label, Select, Textarea } from "@medusajs/ui";
import { useParams, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useListPartnerPaymentMethods } from "../../../../hooks/api/payment-methods";
import { useCreatePaymentAndLink } from "../../../../hooks/api/payments";

const AddPaymentForPartner = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { paymentMethods } = useListPartnerPaymentMethods(id!);
  const { mutateAsync, isPending } = useCreatePaymentAndLink();

  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [paidToId, setPaidToId] = useState<string>("__none__");

  const onCreate = async () => {
    // derive payment_type from selected payment method if any
    const selected = (paymentMethods || []).find((m: any) => m.id === paidToId);
    const derivedPaymentType = selected
      ? (selected.type === "bank_account"
          ? "Bank"
          : selected.type === "cash_account"
          ? "Cash"
          : "Digital_Wallet")
      : "Cash";

    await mutateAsync({
      payment: {
        amount: Number(amount),
        payment_type: derivedPaymentType as any,
        payment_date: new Date(paymentDate),
        metadata: note ? { note } : undefined,
        paid_to_id: paidToId === "__none__" ? undefined : paidToId,
      },
      partnerIds: [id!],
    });
    navigate("..", { replace: true });
  };

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title>Add Payment</RouteDrawer.Title>
        <RouteDrawer.Description>
          Create a payment for this partner and optionally link a payment method.
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-col gap-y-4">
        <div className="grid gap-y-2">
          <Label htmlFor="amount">Amount</Label>
          <Input id="amount" type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        
        <div className="grid gap-y-2">
          <Label htmlFor="payment_date">Payment Date</Label>
          <Input id="payment_date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </div>
        <div className="grid gap-y-2">
          <Label>Payment Method (optional)</Label>
          <Select value={paidToId} onValueChange={setPaidToId}>
            <Select.Trigger>
              <Select.Value placeholder="Select a method" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="__none__">None</Select.Item>
              {(paymentMethods || []).map((m: any) => (
                <Select.Item key={m.id} value={m.id}>
                  {m.type} {m.account_name ? `- ${m.account_name}` : ""}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div className="grid gap-y-2">
          <Label htmlFor="note">Note</Label>
          <Textarea id="note" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <RouteDrawer.Close asChild>
          <Button variant="secondary" size="small">Cancel</Button>
        </RouteDrawer.Close>
        <Button size="small" onClick={onCreate} disabled={isPending || !amount}>Create Payment</Button>
      </RouteDrawer.Footer>
    </RouteDrawer>
  );
}
;

export default AddPaymentForPartner;
