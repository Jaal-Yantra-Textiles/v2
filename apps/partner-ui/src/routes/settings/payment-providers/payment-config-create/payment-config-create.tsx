import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { Form } from "../../../../components/common/form"
import { RouteFocusModal } from "../../../../components/modals/route-focus-modal"
import { KeyboundForm } from "../../../../components/utilities/keybound-form"
import { useRouteModal } from "../../../../components/modals"
import {
  useCreatePaymentConfig,
  type CreatePaymentConfigPayload,
} from "../../../../hooks/api/payment-config"

const CreatePaymentConfigSchema = z
  .object({
    provider_id: z.enum(["pp_payu_payu", "pp_stripe_stripe"]),
    // PayU fields
    merchant_key: z.string().optional(),
    merchant_salt: z.string().optional(),
    mode: z.enum(["test", "live"]).optional(),
    // Stripe fields
    api_key: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.provider_id === "pp_payu_payu") {
      if (!data.merchant_key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Merchant key is required for PayU",
          path: ["merchant_key"],
        })
      }
      if (!data.merchant_salt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Merchant salt is required for PayU",
          path: ["merchant_salt"],
        })
      }
    }
    if (data.provider_id === "pp_stripe_stripe") {
      if (!data.api_key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "API key is required for Stripe",
          path: ["api_key"],
        })
      }
    }
  })

type FormValues = z.infer<typeof CreatePaymentConfigSchema>

export const PaymentConfigCreate = () => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const { mutateAsync: createConfig, isPending } = useCreatePaymentConfig()

  const form = useForm<FormValues>({
    defaultValues: {
      provider_id: "pp_stripe_stripe",
      merchant_key: "",
      merchant_salt: "",
      mode: "test",
      api_key: "",
    },
    resolver: zodResolver(CreatePaymentConfigSchema),
  })

  const selectedProvider = form.watch("provider_id")

  const handleSubmit = form.handleSubmit(async (values) => {
    let payload: CreatePaymentConfigPayload

    if (values.provider_id === "pp_payu_payu") {
      payload = {
        provider_id: "pp_payu_payu",
        credentials: {
          merchant_key: values.merchant_key,
          merchant_salt: values.merchant_salt,
          mode: values.mode,
        },
        is_active: true,
      }
    } else {
      payload = {
        provider_id: "pp_stripe_stripe",
        credentials: {
          api_key: values.api_key,
        },
        is_active: true,
      }
    }

    await createConfig(payload, {
      onSuccess: () => {
        toast.success("Payment credentials saved")
        handleSuccess()
      },
      onError: (e) => {
        toast.error(e.message || "Failed to save credentials")
      },
    })
  })

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex h-full w-full flex-col items-center overflow-y-auto py-16">
        <div className="flex w-full max-w-[720px] flex-col gap-y-8">
          <div>
            <Heading>Add Payment Credentials</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Configure your own payment provider credentials. This overrides
              the platform defaults for your store.
            </Text>
          </div>

          <KeyboundForm onSubmit={handleSubmit} className="flex flex-col gap-y-8">
            <Form.Field
              control={form.control}
              name="provider_id"
              render={({ field: { onChange, ...field } }) => (
                <Form.Item>
                  <Form.Label>Provider</Form.Label>
                  <Form.Control>
                    <Select {...field} onValueChange={onChange}>
                      <Select.Trigger ref={field.ref}>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="pp_stripe_stripe">
                          Stripe
                        </Select.Item>
                        <Select.Item value="pp_payu_payu">PayU</Select.Item>
                      </Select.Content>
                    </Select>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            {selectedProvider === "pp_payu_payu" && (
              <>
                <Form.Field
                  control={form.control}
                  name="merchant_key"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Merchant Key</Form.Label>
                      <Form.Control>
                        <Input
                          placeholder="Your PayU merchant key"
                          {...field}
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  control={form.control}
                  name="merchant_salt"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Merchant Salt</Form.Label>
                      <Form.Control>
                        <Input
                          type="password"
                          placeholder="Your PayU merchant salt"
                          {...field}
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                <Form.Field
                  control={form.control}
                  name="mode"
                  render={({ field: { onChange, ...field } }) => (
                    <Form.Item>
                      <Form.Label>Mode</Form.Label>
                      <Form.Control>
                        <Select {...field} onValueChange={onChange}>
                          <Select.Trigger ref={field.ref}>
                            <Select.Value />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Item value="test">Test</Select.Item>
                            <Select.Item value="live">Live</Select.Item>
                          </Select.Content>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </>
            )}

            {selectedProvider === "pp_stripe_stripe" && (
              <Form.Field
                control={form.control}
                name="api_key"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Stripe API Key</Form.Label>
                    <Form.Control>
                      <Input
                        type="password"
                        placeholder="sk_live_... or sk_test_..."
                        {...field}
                      />
                    </Form.Control>
                    <Form.Hint>
                      Your Stripe secret key from the Stripe dashboard.
                    </Form.Hint>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            )}

            <div className="flex items-center justify-end gap-x-2">
              <RouteFocusModal.Close asChild>
                <Button size="small" variant="secondary">
                  {t("actions.cancel")}
                </Button>
              </RouteFocusModal.Close>
              <Button size="small" type="submit" isLoading={isPending}>
                {t("actions.save")}
              </Button>
            </div>
          </KeyboundForm>
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}
