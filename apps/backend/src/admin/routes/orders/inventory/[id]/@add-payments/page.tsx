import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { Button, Input, Label, Select, Textarea, DatePicker, Text, IconButton, toast } from "@medusajs/ui";
import { Trash, DocumentText } from "@medusajs/icons";
import { useParams, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useListPartnerPaymentMethods } from "../../../../../hooks/api/payment-methods";
import { useCreatePaymentAndLink } from "../../../../../hooks/api/payments";
import { useFileUpload } from "../../../../../hooks/api/upload";
import { FileUpload } from "../../../../../components/common/file-upload";
import { useInventoryOrder } from "../../../../../hooks/api/inventory-orders";

type PaymentAttachment = {
  file_id: string;
  url: string;
  filename?: string;
  mime_type?: string;
  size?: number;
};

const AddPaymentForInventoryOrder = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { inventoryOrder } = useInventoryOrder(id!, {
    fields: ["+partner.*"],
  });
  const partnerId = inventoryOrder?.partner?.id;
  const { paymentMethods } = useListPartnerPaymentMethods(partnerId || "__skip__", undefined, {
    enabled: !!partnerId,
  });
  const { mutateAsync, isPending } = useCreatePaymentAndLink();
  const { mutateAsync: uploadFile } = useFileUpload();

  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<Date | null>(() => new Date());
  const [paidToId, setPaidToId] = useState<string>("__none__");
  const [attachments, setAttachments] = useState<PaymentAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const onUploaded = async (files: { file: File; url: string }[]) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded: PaymentAttachment[] = [];
      for (const { file } of files) {
        const res = await uploadFile({ files: [file] });
        const f = res.files?.[0];
        if (f?.id && f?.url) {
          uploaded.push({
            file_id: f.id,
            url: f.url,
            filename: file.name,
            mime_type: file.type || undefined,
            size: typeof file.size === "number" ? file.size : undefined,
          });
        }
      }
      if (uploaded.length) {
        setAttachments((prev) => [...prev, ...uploaded]);
        toast.success(`${uploaded.length} file(s) attached`);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to upload attachment");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (fileId: string) => {
    setAttachments((prev) => prev.filter((a) => a.file_id !== fileId));
  };

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

    try {
      const numericAmount = Number(amount);
      await mutateAsync({
        payment: {
          amount: numericAmount,
          payment_type: derivedPaymentType as any,
          payment_date: paymentDate ?? new Date(),
          metadata: note ? { note } : undefined,
          paid_to_id: paidToId === "__none__" ? undefined : paidToId,
        },
        inventoryOrderIds: [id!],
        attachments: attachments.length ? attachments : undefined,
      });
      toast.success("Payment created successfully");
      navigate("..", { replace: true });
    } catch (e: any) {
      toast.error(e?.message || "Failed to create payment");
    }
  };

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title>Add Payment</RouteDrawer.Title>
        <RouteDrawer.Description>
          Create a payment for this inventory order.
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <RouteDrawer.Body className="flex flex-col gap-y-4 pb-24">
        <div className="grid gap-y-2">
          <Label htmlFor="amount">Amount</Label>
          <Input id="amount" type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>

        <div className="grid gap-y-2">
          <Label htmlFor="payment_date">Payment Date</Label>
          <DatePicker
            value={paymentDate}
            onChange={(date) => setPaymentDate(date)}
          />
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
        <div className="grid gap-y-2">
          <Label>Attachments (optional)</Label>
          <FileUpload
            label={uploading ? "Uploading..." : "Upload receipts / invoices"}
            hint="PDF or image references for this payment"
            multiple
            isLoading={uploading}
            onUploaded={onUploaded}
          />
          {attachments.length > 0 && (
            <div className="flex flex-col gap-y-1 pt-1">
              {attachments.map((a) => (
                <div
                  key={a.file_id}
                  className="flex items-center justify-between rounded-md border border-ui-border-base bg-ui-bg-subtle px-2 py-1"
                >
                  <div className="flex items-center gap-x-2 overflow-hidden">
                    <DocumentText className="text-ui-fg-muted" />
                    <Text size="xsmall" className="truncate text-ui-fg-subtle">
                      {a.filename || a.file_id}
                    </Text>
                  </div>
                  <IconButton
                    size="small"
                    variant="transparent"
                    onClick={() => removeAttachment(a.file_id)}
                    aria-label="Remove attachment"
                  >
                    <Trash />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer className="sticky bottom-0 bg-ui-bg-base border-t border-ui-border-base">
        <RouteDrawer.Close asChild>
          <Button variant="secondary" size="small">Cancel</Button>
        </RouteDrawer.Close>
        <Button size="small" onClick={onCreate} disabled={isPending || Number(amount) <= 0 || !paymentDate}>{isPending ? "Creating..." : "Create Payment"}</Button>
      </RouteDrawer.Footer>
    </RouteDrawer>
  );
};

export default AddPaymentForInventoryOrder;
