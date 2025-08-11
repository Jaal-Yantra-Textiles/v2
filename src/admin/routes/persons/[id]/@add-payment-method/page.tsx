import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import { Button, Input, Label, Select, Textarea } from "@medusajs/ui";
import { useParams, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useCreatePersonPaymentMethod } from "../../../../hooks/api/payment-methods";

const AddPaymentMethodForPerson = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { mutateAsync, isPending } = useCreatePersonPaymentMethod(id!);

  const [type, setType] = useState<string>("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [walletId, setWalletId] = useState("");
  const [note, setNote] = useState("");

  const onCreate = async () => {
    await mutateAsync({
      type, // must match API enum validation
      account_name: accountName || undefined,
      account_number: accountNumber || undefined,
      bank_name: bankName || undefined,
      ifsc_code: ifsc || undefined,
      wallet_id: walletId || undefined,
      metadata: note ? { note } : undefined,
    });
    navigate("..", { replace: true });
  };

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title>Add Payment Method</RouteDrawer.Title>
        <RouteDrawer.Description>
          Create and link a payment method to this person.
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-col gap-y-4">
        <div className="grid gap-y-2">
          <Label>Type</Label>
          <Select value={type} onValueChange={setType}>
            <Select.Trigger>
              <Select.Value placeholder="Select a type" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="bank_account">Bank Account</Select.Item>
              <Select.Item value="cash_account">Cash Account</Select.Item>
              <Select.Item value="digital_wallet">Digital Wallet</Select.Item>
            </Select.Content>
          </Select>
        </div>
        <div className="grid gap-y-2">
          <Label>Account Name</Label>
          <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        </div>
        <div className="grid gap-y-2">
          <Label>Account Number</Label>
          <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
        </div>
        <div className="grid gap-y-2">
          <Label>Bank Name</Label>
          <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
        </div>
        <div className="grid gap-y-2">
          <Label>IFSC</Label>
          <Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} />
        </div>
        <div className="grid gap-y-2">
          <Label>Wallet ID</Label>
          <Input value={walletId} onChange={(e) => setWalletId(e.target.value)} />
        </div>
        <div className="grid gap-y-2">
          <Label>Note</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <RouteDrawer.Close asChild>
          <Button variant="secondary" size="small">Cancel</Button>
        </RouteDrawer.Close>
        <Button size="small" onClick={onCreate} disabled={isPending || !type}>Create Method</Button>
      </RouteDrawer.Footer>
    </RouteDrawer>
  );
};

export default AddPaymentMethodForPerson;
