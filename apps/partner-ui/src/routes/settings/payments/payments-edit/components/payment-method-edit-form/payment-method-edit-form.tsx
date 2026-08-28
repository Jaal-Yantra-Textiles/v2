import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Input, Select, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import * as zod from "zod"

import { Form } from "../../../../../../components/common/form"
import { RouteDrawer, useRouteModal } from "../../../../../../components/modals"
import { KeyboundForm } from "../../../../../../components/utilities/keybound-form"
import {
  PartnerPaymentMethod,
  useUpdatePartnerPaymentMethod,
} from "../../../../../../hooks/api/partner-payment-methods"
import { useMe } from "../../../../../../hooks/api/users"

const EditPaymentMethodSchema = zod.object({
  type: zod.enum(["bank_account", "cash_account", "digital_wallet"]),
  account_name: zod.string().min(1, "Account name is required"),
  account_number: zod.string().optional(),
  bank_name: zod.string().optional(),
  ifsc_code: zod.string().optional(),
  wallet_id: zod.string().optional(),
})

type EditPaymentMethodValues = zod.infer<typeof EditPaymentMethodSchema>

type PaymentMethodEditFormProps = {
  paymentMethod: PartnerPaymentMethod
}

export const PaymentMethodEditForm = ({
  paymentMethod,
}: PaymentMethodEditFormProps) => {
  const { t } = useTranslation()
  const { user } = useMe()
  const partnerId = user?.partner_id
  const { handleSuccess } = useRouteModal()

  const form = useForm<EditPaymentMethodValues>({
    defaultValues: {
      type: (paymentMethod.type as EditPaymentMethodValues["type"]) || "bank_account",
      account_name: paymentMethod.account_name || "",
      account_number: paymentMethod.account_number || "",
      bank_name: paymentMethod.bank_name || "",
      ifsc_code: paymentMethod.ifsc_code || "",
      wallet_id: paymentMethod.wallet_id || "",
    },
    resolver: zodResolver(EditPaymentMethodSchema),
  })

  const { mutateAsync, isPending } = useUpdatePartnerPaymentMethod(
    partnerId || "",
    paymentMethod.id
  )

  const type = form.watch("type")

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!partnerId) {
      return
    }

    await mutateAsync(values, {
      onSuccess: () => {
        toast.success(t("partner.payments.toast.updated"))
        handleSuccess("..")
      },
      onError: (e) => {
        toast.error(e.message)
      },
    })
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex h-full flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-4 overflow-y-auto">
          <Form.Field
            control={form.control}
            name="type"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>{t("partner.payments.form.type")}</Form.Label>
                <Form.Control>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <Select.Trigger>
                      <Select.Value placeholder={t("partner.payments.form.typePlaceholder")} />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="bank_account">
                        {t("partner.payments.typeLabels.bankAccount")}
                      </Select.Item>
                      <Select.Item value="cash_account">
                        {t("partner.payments.typeLabels.cashAccount")}
                      </Select.Item>
                      <Select.Item value="digital_wallet">
                        {t("partner.payments.typeLabels.digitalWallet")}
                      </Select.Item>
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
              <Form.Item>
                <Form.Label>{t("partner.payments.form.accountName")}</Form.Label>
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
                    <Form.Label>{t("partner.payments.form.accountNumber")}</Form.Label>
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
                    <Form.Label>{t("partner.payments.form.bankName")}</Form.Label>
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
                  <Form.Item>
                    <Form.Label>{t("partner.payments.form.ifsc")}</Form.Label>
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
                <Form.Item>
                  <Form.Label>{t("partner.payments.form.walletId")}</Form.Label>
                  <Form.Control>
                    <Input {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          )}
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                {t("partner.payments.form.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
              disabled={!partnerId}
            >
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}