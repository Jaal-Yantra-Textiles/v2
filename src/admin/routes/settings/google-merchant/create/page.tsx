import { Button, Container, Heading, Input, Label, Text, toast, Textarea } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { useState } from "react"
import { useCreateGoogleMerchantAccount } from "../../../../hooks/api/google-merchant"

const defaultRedirectUri = () => {
  if (typeof window === "undefined") return ""
  return `${window.location.origin}/app/settings/google-merchant/oauth-callback`
}

const CreateGoogleMerchantPage = () => {
  const navigate = useNavigate()
  const createMutation = useCreateGoogleMerchantAccount()

  const [form, setForm] = useState({
    name: "",
    merchant_id: "",
    client_id: "",
    client_secret: "",
    redirect_uri: defaultRedirectUri(),
    account_email: "",
    scope: "https://www.googleapis.com/auth/content",
    landing_url_base: "",
    content_language: "en",
    feed_label: "US",
    currency_code: "USD",
  })

  const set = (k: keyof typeof form, v: string) => setForm((prev) => ({ ...prev, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.merchant_id || !form.client_id || !form.client_secret || !form.redirect_uri) {
      toast.error("Name, Merchant ID, Client ID, Client Secret and Redirect URI are required")
      return
    }
    try {
      const result = await createMutation.mutateAsync({
        name: form.name,
        merchant_id: form.merchant_id,
        client_id: form.client_id,
        client_secret: form.client_secret,
        redirect_uri: form.redirect_uri,
        scope: form.scope,
        account_email: form.account_email || undefined,
        api_config: {
          landing_url_base: form.landing_url_base || undefined,
          content_language: form.content_language,
          feed_label: form.feed_label,
          currency_code: form.currency_code,
        },
      })
      toast.success("Account created — click Connect on the detail page to authorize")
      navigate(`/settings/google-merchant/${result.account.id}`)
    } catch (err: any) {
      toast.error(err?.message || "Failed to create account")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>Add Google Merchant Account</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Enter OAuth credentials from your Google Cloud Console project. After saving, click Connect to authorize.
        </Text>
      </div>

      <form onSubmit={handleSubmit} className="px-6 py-4 flex flex-col gap-y-4 max-w-2xl">
        <Field label="Name" required>
          <Input placeholder="My Main Merchant Center" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Merchant Center ID" required hint="Numeric ID from merchants.google.com">
          <Input value={form.merchant_id} onChange={(e) => set("merchant_id", e.target.value)} />
        </Field>
        <Field label="OAuth Client ID" required>
          <Input value={form.client_id} onChange={(e) => set("client_id", e.target.value)} />
        </Field>
        <Field label="OAuth Client Secret" required hint="Stored encrypted; never echoed back">
          <Input type="password" value={form.client_secret} onChange={(e) => set("client_secret", e.target.value)} />
        </Field>
        <Field label="Redirect URI" required hint="Must match exactly what's registered in Google Cloud Console">
          <Input value={form.redirect_uri} onChange={(e) => set("redirect_uri", e.target.value)} />
        </Field>
        <Field label="OAuth Scope">
          <Input value={form.scope} onChange={(e) => set("scope", e.target.value)} />
        </Field>
        <Field label="Account Email">
          <Input value={form.account_email} onChange={(e) => set("account_email", e.target.value)} />
        </Field>

        <div className="pt-4 border-t">
          <Text size="small" weight="plus">Product feed defaults</Text>
          <Text size="xsmall" className="text-ui-fg-subtle">These apply to products synced from this account unless overridden.</Text>
        </div>
        <Field label="Storefront base URL" hint="e.g. https://shop.example.com — used to build product landing URLs">
          <Input value={form.landing_url_base} onChange={(e) => set("landing_url_base", e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-x-4">
          <Field label="Content language">
            <Input value={form.content_language} onChange={(e) => set("content_language", e.target.value)} />
          </Field>
          <Field label="Feed label">
            <Input value={form.feed_label} onChange={(e) => set("feed_label", e.target.value)} />
          </Field>
          <Field label="Currency">
            <Input value={form.currency_code} onChange={(e) => set("currency_code", e.target.value)} />
          </Field>
        </div>

        <div className="flex gap-x-2 pt-2">
          <Button type="button" variant="secondary" onClick={() => navigate("/settings/google-merchant")}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={createMutation.isPending}>Save</Button>
        </div>
      </form>
    </Container>
  )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-y-1">
      <Label size="small" weight="plus">
        {label} {required && <span className="text-ui-fg-error">*</span>}
      </Label>
      {children}
      {hint && <Text size="xsmall" className="text-ui-fg-subtle">{hint}</Text>}
    </div>
  )
}

export default CreateGoogleMerchantPage
