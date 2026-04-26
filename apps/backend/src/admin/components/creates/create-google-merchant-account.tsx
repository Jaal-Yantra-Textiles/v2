import { Button, Heading, Input, Text, toast } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "@medusajs/framework/zod"
import { useNavigate } from "react-router-dom"
import { Form } from "../common/form"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { KeyboundForm } from "../utilitites/key-bound-form"
import { useCreateGoogleMerchantAccount } from "../../hooks/api/google-merchant"

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  merchant_id: z.string().min(1, "Merchant ID is required"),
  client_id: z.string().min(1, "Client ID is required"),
  client_secret: z.string().min(1, "Client Secret is required"),
  redirect_uri: z.url("Must be a valid URL"),
  scope: z.string().optional(),
  account_email: z.email("Invalid email").or(z.literal("")).optional(),
  landing_url_base: z.url("Must be a valid URL").or(z.literal("")).optional(),
  content_language: z.string().min(2),
  feed_label: z.string().min(1),
  currency_code: z.string().length(3),
})

type FormValues = z.infer<typeof schema>

const defaultRedirectUri = () => {
  if (typeof window === "undefined") return ""
  return `${window.location.origin}/app/settings/google-merchant/oauth-callback`
}

export const CreateGoogleMerchantAccount = () => {
  const navigate = useNavigate()
  const createMutation = useCreateGoogleMerchantAccount()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      merchant_id: "",
      client_id: "",
      client_secret: "",
      redirect_uri: defaultRedirectUri(),
      scope: "https://www.googleapis.com/auth/content",
      account_email: "",
      landing_url_base: "",
      content_language: "en",
      feed_label: "US",
      currency_code: "USD",
    },
  })

  const handleSubmit = async (values: FormValues) => {
    try {
      const result = await createMutation.mutateAsync({
        name: values.name,
        merchant_id: values.merchant_id,
        client_id: values.client_id,
        client_secret: values.client_secret,
        redirect_uri: values.redirect_uri,
        scope: values.scope || undefined,
        account_email: values.account_email || undefined,
        api_config: {
          landing_url_base: values.landing_url_base || undefined,
          content_language: values.content_language,
          feed_label: values.feed_label,
          currency_code: values.currency_code,
        },
      })
      toast.success("Account created — click Connect on the detail page to authorize")
      navigate(`/settings/google-merchant/${result.account.id}`, {
        replace: true,
        state: { isSubmitSuccessful: true },
      })
    } catch (err: any) {
      toast.error(err?.message || "Failed to create account")
    }
  }

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex h-full flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">Cancel</Button>
            </RouteFocusModal.Close>
            <Button size="small" type="submit" isLoading={createMutation.isPending} className="shrink-0">
              Save
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-8 md:py-16 px-4 md:px-6">
          <div className="flex w-full max-w-[720px] flex-col gap-y-6 md:gap-y-8">
            <div>
              <Heading className="text-xl md:text-2xl">Add Google Merchant Account</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                Enter OAuth credentials from your Google Cloud Console project. After saving, click Connect on the detail page to authorize.
              </Text>
            </div>

            <section className="flex flex-col gap-y-4">
              <Text size="small" weight="plus">OAuth credentials</Text>

              <Form.Field
                control={form.control}
                name="name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Name</Form.Label>
                    <Form.Control>
                      <Input {...field} placeholder="My Main Merchant Center" />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="merchant_id"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Merchant Center ID</Form.Label>
                    <Form.Hint>Numeric ID from merchants.google.com</Form.Hint>
                    <Form.Control>
                      <Input {...field} placeholder="1234567890" />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Form.Field
                  control={form.control}
                  name="client_id"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>OAuth Client ID</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="xxxxx.apps.googleusercontent.com" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="client_secret"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>OAuth Client Secret</Form.Label>
                      <Form.Hint>Stored encrypted; never echoed back</Form.Hint>
                      <Form.Control>
                        <Input {...field} type="password" autoComplete="new-password" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>

              <Form.Field
                control={form.control}
                name="redirect_uri"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Redirect URI</Form.Label>
                    <Form.Hint>Must match exactly what's registered in Google Cloud Console</Form.Hint>
                    <Form.Control>
                      <Input {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Form.Field
                  control={form.control}
                  name="scope"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>OAuth Scope</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="account_email"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Account Email (optional)</Form.Label>
                      <Form.Control>
                        <Input {...field} placeholder="merchant@example.com" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </section>

            <section className="flex flex-col gap-y-4 border-t pt-6">
              <div>
                <Text size="small" weight="plus">Product feed defaults</Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Applied to products synced from this account unless overridden at sync time.
                </Text>
              </div>

              <Form.Field
                control={form.control}
                name="landing_url_base"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Storefront base URL</Form.Label>
                    <Form.Hint>e.g. https://shop.example.com — used to build product landing URLs</Form.Hint>
                    <Form.Control>
                      <Input {...field} placeholder="https://shop.example.com" />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Form.Field
                  control={form.control}
                  name="content_language"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Content language</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="feed_label"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Feed label</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="currency_code"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Currency</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </section>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
