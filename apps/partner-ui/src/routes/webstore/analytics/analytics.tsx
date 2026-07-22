import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import {
  Button,
  Container,
  Heading,
  Input,
  RadioGroup,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"

import { Form } from "../../../components/common/form"
import { SingleColumnPage } from "../../../components/layout/pages"
import { Skeleton } from "../../../components/common/skeleton"
import {
  AnalyticsProvider,
  useUpdateWebsiteAnalytics,
  useWebsiteAnalytics,
} from "../../../hooks/api/website-analytics"

const PROVIDER_VALUES = ["in_house", "custom", "off"] as const

const analyticsSchema = z.object({
  provider: z.enum(PROVIDER_VALUES),
  custom_head: z.string().nullable(),
  custom_body_end: z.string().nullable(),
  google_site_verification: z.string().nullable(),
})

type AnalyticsFormValues = z.infer<typeof analyticsSchema>

export const WebstoreAnalytics = () => {
  return (
    <SingleColumnPage
      widgets={{ before: [], after: [] }}
      hasOutlet={false}
    >
      <AnalyticsInner />
    </SingleColumnPage>
  )
}

const AnalyticsInner = () => {
  const { t } = useTranslation()
  const { analytics, isPending, isError, error } = useWebsiteAnalytics()
  const { mutateAsync, isPending: isSaving } = useUpdateWebsiteAnalytics()

  const form = useForm<AnalyticsFormValues>({
    defaultValues: {
      provider: "in_house",
      custom_head: "",
      custom_body_end: "",
      google_site_verification: "",
    },
    resolver: zodResolver(analyticsSchema),
  })

  // Sync form once the API responds. We can't pass these as defaultValues
  // because the data isn't loaded on first render.
  useEffect(() => {
    if (!analytics) return
    form.reset({
      provider: analytics.provider,
      custom_head: analytics.custom_head ?? "",
      custom_body_end: analytics.custom_body_end ?? "",
      google_site_verification: analytics.google_site_verification ?? "",
    })
  }, [analytics, form])

  const provider = form.watch("provider")

  const handleSubmit = form.handleSubmit(async (values) => {
    await mutateAsync(
      {
        provider: values.provider,
        // Only persist custom blocks when relevant; collapse to null
        // when empty so the API can distinguish "cleared" from "untouched".
        custom_head:
          values.provider === "custom" && values.custom_head?.trim()
            ? values.custom_head
            : null,
        custom_body_end:
          values.provider === "custom" && values.custom_body_end?.trim()
            ? values.custom_body_end
            : null,
        // SEO verification is independent of the analytics provider — persist
        // it whenever set, collapsing empty to null so "cleared" is explicit.
        google_site_verification: values.google_site_verification?.trim()
          ? values.google_site_verification.trim()
          : null,
      },
      {
        onSuccess: () => {
          toast.success(
            t(
              "webstore.analytics.toast.updated",
              "Analytics settings updated"
            )
          )
        },
        onError: (err) => {
          toast.error(err?.message || "Failed to update analytics settings")
        },
      }
    )
  })

  if (isPending) {
    return (
      <Container className="p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-4 w-96 mb-8" />
        <Skeleton className="h-32 w-full" />
      </Container>
    )
  }

  if (isError) {
    return (
      <Container className="p-6">
        <Heading level="h2">
          {t(
            "webstore.analytics.error.heading",
            "Couldn't load analytics settings"
          )}
        </Heading>
        <Text size="small" className="text-ui-fg-subtle mt-2">
          {error?.message ||
            t(
              "webstore.analytics.error.body",
              "Provision your storefront from Settings before configuring analytics."
            )}
        </Text>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>
          {t("webstore.analytics.heading", "Analytics")}
        </Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t(
            "webstore.analytics.subtitle",
            "Choose how visitor analytics are tracked on your storefront. The default uses our in-house tracker; switch to custom to plug in your own provider (GA, Plausible, GTM, etc.)."
          )}
        </Text>
      </div>

      <Form {...form}>
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-6 py-6 flex flex-col gap-y-6">
            <Form.Field
              control={form.control}
              name="provider"
              render={({ field: { onChange, ...field } }) => (
                <Form.Item>
                  <Form.Label>
                    {t("webstore.analytics.fields.provider.label", "Provider")}
                  </Form.Label>
                  <Form.Control>
                    <RadioGroup
                      {...field}
                      onValueChange={(v) => onChange(v as AnalyticsProvider)}
                    >
                      <RadioGroup.ChoiceBox
                        value="in_house"
                        label={t(
                          "webstore.analytics.fields.provider.in_house.label",
                          "JYT in-house analytics"
                        )}
                        description={t(
                          "webstore.analytics.fields.provider.in_house.description",
                          "Default. Loads our analytics.min.js and feeds the dashboard you already have."
                        )}
                      />
                      <RadioGroup.ChoiceBox
                        value="custom"
                        label={t(
                          "webstore.analytics.fields.provider.custom.label",
                          "Custom provider"
                        )}
                        description={t(
                          "webstore.analytics.fields.provider.custom.description",
                          "Paste a snippet from Google Analytics, Plausible, Tag Manager, etc. Goes into <head> and/or before </body>."
                        )}
                      />
                      <RadioGroup.ChoiceBox
                        value="off"
                        label={t(
                          "webstore.analytics.fields.provider.off.label",
                          "Off"
                        )}
                        description={t(
                          "webstore.analytics.fields.provider.off.description",
                          "No analytics scripts are loaded on your storefront."
                        )}
                      />
                    </RadioGroup>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            {provider === "in_house" && analytics?.website_id && (
              <div className="bg-ui-bg-subtle rounded-md p-4">
                <Text size="small" weight="plus" className="mb-1">
                  {t(
                    "webstore.analytics.in_house.snippet.heading",
                    "Already wired up"
                  )}
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {t(
                    "webstore.analytics.in_house.snippet.body",
                    "Your storefront automatically loads the JYT tracker with website id"
                  )}{" "}
                  <code className="text-ui-fg-base">
                    {analytics.website_id}
                  </code>
                  .
                </Text>
              </div>
            )}

            {provider === "custom" && (
              <>
                <Form.Field
                  control={form.control}
                  name="custom_head"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>
                        {t(
                          "webstore.analytics.fields.custom_head.label",
                          "Head snippet"
                        )}
                      </Form.Label>
                      <Form.Hint>
                        {t(
                          "webstore.analytics.fields.custom_head.hint",
                          "Injected at the top of the page. Most providers (GA4, Plausible, GTM) want their snippet here."
                        )}
                      </Form.Hint>
                      <Form.Control>
                        <Textarea
                          {...field}
                          value={field.value ?? ""}
                          rows={6}
                          placeholder={
                            "<!-- Google tag (gtag.js) -->\n<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX\"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n  gtag('config', 'G-XXXXXXX');\n</script>"
                          }
                          className="font-mono text-xs"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="custom_body_end"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>
                        {t(
                          "webstore.analytics.fields.custom_body_end.label",
                          "Body-end snippet (optional)"
                        )}
                      </Form.Label>
                      <Form.Hint>
                        {t(
                          "webstore.analytics.fields.custom_body_end.hint",
                          "Injected just before </body>. Use for GTM noscript fallbacks and providers that need a body-end tag."
                        )}
                      </Form.Hint>
                      <Form.Control>
                        <Textarea
                          {...field}
                          value={field.value ?? ""}
                          rows={4}
                          placeholder={
                            "<!-- Google Tag Manager (noscript) -->\n<noscript><iframe src=\"https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX\" height=\"0\" width=\"0\" style=\"display:none;visibility:hidden\"></iframe></noscript>"
                          }
                          className="font-mono text-xs"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </>
            )}

            {/* SEO — Search Console verification. Independent of the analytics
                provider: the storefront always injects this as
                <meta name="google-site-verification">. (#349) */}
            <div className="border-t pt-6 flex flex-col gap-y-1">
              <Text size="small" weight="plus">
                {t(
                  "webstore.analytics.seo.heading",
                  "Search Console verification"
                )}
              </Text>
              <Text size="small" className="text-ui-fg-subtle">
                {t(
                  "webstore.analytics.seo.subtitle",
                  "Verify your storefront in Google Search Console using the HTML-tag method. Paste the token from the <meta name=\"google-site-verification\" content=\"…\"> tag Google gives you — just the content value, not the whole tag."
                )}
              </Text>
            </div>

            <Form.Field
              control={form.control}
              name="google_site_verification"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>
                    {t(
                      "webstore.analytics.fields.google_site_verification.label",
                      "Verification token"
                    )}
                  </Form.Label>
                  <Form.Hint>
                    {t(
                      "webstore.analytics.fields.google_site_verification.hint",
                      "Each storefront domain is its own Search Console property. Leave blank to remove."
                    )}
                  </Form.Hint>
                  <Form.Control>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      placeholder="e.g. AbCdEf1234_gHiJkLmNoPqRsTuVwXyZ0123456789"
                      className="font-mono text-xs"
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>

          <div className="flex justify-end gap-x-2 px-6 py-4 border-t">
            <Button type="submit" variant="primary" isLoading={isSaving}>
              {t("actions.save", "Save")}
            </Button>
          </div>
        </form>
      </Form>
    </Container>
  )
}
