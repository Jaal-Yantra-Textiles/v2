import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import { z as zod } from "@medusajs/framework/zod"

import { Form } from "../../../../components/common/form"
import { RouteFocusModal } from "../../../../components/modals"
import { useMe } from "../../../../hooks/api/users"
import { useCreatePartnerPaymentMethod } from "../../../../hooks/api/partner-payment-methods"

const CreatePaymentMethodSchema = zod.object({
  type: zod.enum(["bank_account", "cash_account", "digital_wallet"]),
  account_name: zod.string().min(1, "Account name is required"),
  account_number: zod.string().optional(),
  bank_name: zod.string().optional(),
  ifsc_code: zod.string().optional(),
  wallet_id: zod.string().optional(),
})

type CreatePaymentMethodValues = zod.infer<typeof CreatePaymentMethodSchema>

export const SettingsPaymentsCreate = () => {
  const navigate = useNavigate()
  const { user } = useMe()
  const partnerId = user?.partner_id

  const { mutateAsync, isPending } = useCreatePartnerPaymentMethod(partnerId || "")

  const form = useForm<CreatePaymentMethodValues>({
    defaultValues: {
      type: "bank_account",
      account_name: "",
      account_number: "",
      bank_name: "",
      ifsc_code: "",
      wallet_id: "",
    },
    resolver: zodResolver(CreatePaymentMethodSchema),
  })

  const type = form.watch("type")

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!partnerId) {
      return
    }

    try {
      await mutateAsync(values)
      toast.success("Payment method created successfully")
      form.reset()
      navigate("..", { replace: true })
    } catch (e: any) {
      toast.error(e?.message || "Failed to create payment method")
    }
  })

  return (
    <RouteFocusModal>
      <RouteFocusModal.Form form={form}>
        <div className="flex h-full flex-col overflow-hidden">
          <RouteFocusModal.Header />
          <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 flex-col items-center overflow-y-auto">
              <div className="flex w-full max-w-[720px] flex-col gap-y-8 px-2 py-16">
                <div>
                  <Heading>Add Payment Method</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Add a payout method reference.
                  </Text>
                </div>

                {!partnerId && (
                  <Text size="small" className="text-ui-fg-subtle">
                    Missing partner context.
                  </Text>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Form.Field
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <Form.Item className="md:col-span-2">
                        <Form.Label>Type</Form.Label>
                        <Form.Control>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <Select.Trigger>
                              <Select.Value placeholder="Select type" />
                            </Select.Trigger>
                            <Select.Content>
                              <Select.Item value="bank_account">Bank Account</Select.Item>
                              <Select.Item value="cash_account">Cash Account</Select.Item>
                              <Select.Item value="digital_wallet">Digital Wallet</Select.Item>
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />

                  <Form.Field
                    control={form.control}
                    name="account_name"
                    render={({ field }) => (
                      <Form.Item className="md:col-span-2">
                        <Form.Label>Account name</Form.Label>
                        <Form.Control>
                          <Input {...field} />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />

                  {type === "bank_account" && (
                    <>
                      <Form.Field
                        control={form.control}
                        name="account_number"
                        render={({ field }) => (
                          <Form.Item>
                            <Form.Label>Account number</Form.Label>
                            <Form.Control>
                              <Input {...field} />
                            </Form.Control>
                            <Form.ErrorMessage />
                          </Form.Item>
                        )}
                      />

                      <Form.Field
                        control={form.control}
                        name="bank_name"
                        render={({ field }) => (
                          <Form.Item>
                            <Form.Label>Bank name</Form.Label>
                            <Form.Control>
                              <Input {...field} />
                            </Form.Control>
                            <Form.ErrorMessage />
                          </Form.Item>
                        )}
                      />

                      <Form.Field
                        control={form.control}
                        name="ifsc_code"
                        render={({ field }) => (
                          <Form.Item className="md:col-span-2">
                            <Form.Label>IFSC</Form.Label>
                            <Form.Control>
                              <Input {...field} />
                            </Form.Control>
                            <Form.ErrorMessage />
                          </Form.Item>
                        )}
                      />
                    </>
                  )}

                  {type === "digital_wallet" && (
                    <Form.Field
                      control={form.control}
                      name="wallet_id"
                      render={({ field }) => (
                        <Form.Item className="md:col-span-2">
                          <Form.Label>Wallet ID</Form.Label>
                          <Form.Control>
                            <Input {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  )}
                </div>

                <div className="flex items-center justify-end">
                  <Button
                    size="small"
                    variant="primary"
                    type="button"
                    onClick={handleSubmit}
                    disabled={!partnerId || isPending}
                  >
                    {isPending ? "Creating..." : "Create"}
                  </Button>
                </div>
              </div>
            </div>
          </RouteFocusModal.Body>
        </div>
      </RouteFocusModal.Form>
    </RouteFocusModal>
  )
}
