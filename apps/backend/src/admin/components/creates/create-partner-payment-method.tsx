import { useState } from "react"
import { Button, Heading, Input, Label, Select, Text, Textarea, toast } from "@medusajs/ui"

import { useModalChrome } from "../modal/chrome/use-modal-chrome"
import { useCreatePartnerPaymentMethod } from "../../hooks/api/payment-methods"

/**
 * Create a payment method and link it to a partner.
 *
 * Lifted out of `routes/partners/[id]/@add-payment-method/page.tsx` so the
 * partner graph can open the same form its route does — chrome and "done" come
 * from whichever shell wraps it (#1856).
 *
 * 🔴 The second of the partner spine's two absence rules. "There is payable
 * work here and no account to pay it into" was measured on eight partners
 * locally, and the graph could state it without being able to fix it: the
 * absent node's action pointed back at the partner page, which from inside the
 * workspace closes the graph to reach the drawer this form now IS.
 */
export const AddPartnerPaymentMethodForm = ({
  partnerId,
}: {
  partnerId: string
}) => {
  const Chrome = useModalChrome()
  const { mutateAsync, isPending } = useCreatePartnerPaymentMethod(partnerId)

  const [type, setType] = useState<string>("")
  const [accountName, setAccountName] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [bankName, setBankName] = useState("")
  const [ifsc, setIfsc] = useState("")
  const [walletId, setWalletId] = useState("")
  const [note, setNote] = useState("")

  const onCreate = async () => {
    try {
      await mutateAsync({
        type,
        account_name: accountName || undefined,
        account_number: accountNumber || undefined,
        bank_name: bankName || undefined,
        ifsc_code: ifsc || undefined,
        wallet_id: walletId || undefined,
        metadata: note ? { note } : undefined,
      })
      toast.success("Payment method created")
      Chrome.onDone()
    } catch (e: any) {
      /*
       * 🔴 The route this replaced navigated away on success and had no catch
       * at all, so a rejected create left the drawer open with no message —
       * indistinguishable from a button that did nothing.
       */
      toast.error("Failed to create payment method", {
        description: e?.message || "The payment method was not created",
      })
    }
  }

  return (
    <>
      <Chrome.Header>
        <div>
          <Chrome.Title asChild>
            <Heading>Add payment method</Heading>
          </Chrome.Title>
          <Text size="small" className="text-ui-fg-subtle">
            Payouts for this partner are paid to a linked method.
          </Text>
        </div>
      </Chrome.Header>

      <Chrome.Body className="flex flex-1 flex-col gap-y-4 overflow-y-auto px-6 py-6">
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
          <Input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
          />
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
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </Chrome.Body>

      <Chrome.Footer className="bg-ui-bg-base border-t border-ui-border-base">
        <div className="flex w-full items-center justify-end gap-x-2">
          <Chrome.Close asChild>
            <Button variant="secondary" size="small" disabled={isPending}>
              Cancel
            </Button>
          </Chrome.Close>
          <Button size="small" onClick={onCreate} disabled={isPending || !type}>
            Create method
          </Button>
        </div>
      </Chrome.Footer>
    </>
  )
}
