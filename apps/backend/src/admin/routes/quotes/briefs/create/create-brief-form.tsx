import { zodResolver } from "@hookform/resolvers/zod"
import { Button, ProgressStatus, ProgressTabs, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useSearchParams } from "react-router-dom"

import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"
import { useRouteModal } from "../../../../components/modal/use-route-modal"
import { KeyboundForm } from "../../../../components/utilitites/key-bound-form"
import { useQuoteRegions } from "../../../../hooks/api/quote-buyer-sources"
import { useCreateQuoteBrief } from "../../../../hooks/api/quote-briefs"
import { BriefBuyerStep } from "./buyer-step"
import { BriefReviewStep } from "./review-step"
import { BriefFormSchema, BriefFormValues, BUYER_FIELDS, newOption, toCreateBody } from "./schema"
import { BriefStylesStep } from "./styles-step"

/**
 * New brief (#2608) in a route focus modal, in steps like the other create
 * forms: Buyer → Styles → Review. Nothing is sent; the buyer's link is issued
 * later from the brief's page.
 *
 * Can be started from a quote draft: ?partner_id=&country=&buyer_email=&recipient_name=&recipient_company=
 *
 * 🔑 Rendered INSIDE `RouteFocusModal` (page.tsx): `useRouteModal` reads the
 * modal's own context, so the modal cannot call it itself (#1352).
 */
enum Tab {
  BUYER = "buyer",
  STYLES = "styles",
  REVIEW = "review",
}
const ORDER = [Tab.BUYER, Tab.STYLES, Tab.REVIEW]

export const CreateBriefForm = () => {
  const { handleSuccess } = useRouteModal()
  const [params] = useSearchParams()
  const create = useCreateQuoteBrief()
  const { regions } = useQuoteRegions()
  const [tab, setTab] = useState<Tab>(Tab.BUYER)
  const [state, setState] = useState<Record<Tab, ProgressStatus>>({
    [Tab.BUYER]: "in-progress",
    [Tab.STYLES]: "not-started",
    [Tab.REVIEW]: "not-started",
  })

  const form = useForm<BriefFormValues>({
    resolver: zodResolver(BriefFormSchema),
    defaultValues: {
      partner_id: params.get("partner_id") ?? "",
      partner_name: params.get("partner_name") ?? params.get("partner_id") ?? "",
      title: "",
      intro: "",
      buyer_email: params.get("buyer_email") ?? "",
      recipient_name: params.get("recipient_name") ?? "",
      recipient_company: params.get("recipient_company") ?? "",
      region_id: "",
      destination_country_code: (params.get("country") ?? "").toLowerCase(),
      sample_quantity: "4",
      sample_days: "14",
      options: [newOption()],
    },
  })

  // Started from a quote draft with only a country: select the region that serves it.
  useEffect(() => {
    const country = form.getValues("destination_country_code")
    if (!country || form.getValues("region_id") || !regions.length) return
    const region = regions.find((r) => r.countries.includes(country))
    if (region) form.setValue("region_id", region.id)
  }, [regions])

  /** Validate only the fields the step owns before moving past it. */
  const validate = async (t: Tab) =>
    t === Tab.BUYER ? form.trigger([...BUYER_FIELDS]) : t === Tab.STYLES ? form.trigger("options") : true

  const goTo = async (next: Tab) => {
    const from = ORDER.indexOf(tab)
    const to = ORDER.indexOf(next)
    if (to > from) {
      for (const t of ORDER.slice(from, to)) {
        if (!(await validate(t))) {
          setTab(t)
          return
        }
      }
    }
    setState((s) => {
      const n = { ...s }
      ORDER.forEach((t, i) => {
        n[t] = i < to ? "completed" : i === to ? "in-progress" : s[t] === "completed" ? "completed" : "not-started"
      })
      return n
    })
    setTab(next)
  }

  const handleSubmit = form.handleSubmit(
    (values) =>
      create.mutate(toCreateBody(values), {
        onSuccess: ({ brief }) => {
          toast.success("Brief created. Open it to get the buyer's link.")
          handleSuccess(`/quotes/briefs/${brief.id}`)
        },
        onError: (e) => toast.error(e.message),
      }),
    () => toast.error("Some fields need attention. Go back to the step marked in progress.")
  )

  const next = ORDER[ORDER.indexOf(tab) + 1]
  const prev = ORDER[ORDER.indexOf(tab) - 1]

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex h-full flex-col overflow-hidden">
        <ProgressTabs value={tab} onValueChange={(v) => goTo(v as Tab)} className="flex h-full flex-col overflow-hidden">
          <RouteFocusModal.Header>
            <RouteFocusModal.Title asChild>
              <span className="sr-only">New brief</span>
            </RouteFocusModal.Title>
            <div className="-my-2 w-full border-l">
              <ProgressTabs.List className="flex w-full items-center justify-start">
                <ProgressTabs.Trigger value={Tab.BUYER} status={state[Tab.BUYER]} className="w-full max-w-[200px] truncate">
                  Buyer
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger value={Tab.STYLES} status={state[Tab.STYLES]} className="w-full max-w-[200px] truncate">
                  Styles
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger value={Tab.REVIEW} status={state[Tab.REVIEW]} className="w-full max-w-[200px] truncate">
                  Review
                </ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>

          <RouteFocusModal.Body className="size-full overflow-hidden">
            <ProgressTabs.Content value={Tab.BUYER} className="size-full overflow-y-auto">
              <BriefBuyerStep form={form} />
            </ProgressTabs.Content>
            <ProgressTabs.Content value={Tab.STYLES} className="size-full overflow-y-auto">
              <BriefStylesStep form={form} />
            </ProgressTabs.Content>
            <ProgressTabs.Content value={Tab.REVIEW} className="size-full overflow-y-auto">
              <BriefReviewStep form={form} />
            </ProgressTabs.Content>
          </RouteFocusModal.Body>

          <RouteFocusModal.Footer>
            <div className="flex items-center justify-end gap-x-2">
              {prev ? (
                <Button size="small" variant="secondary" type="button" onClick={() => goTo(prev)}>
                  Back
                </Button>
              ) : (
                <RouteFocusModal.Close asChild>
                  <Button size="small" variant="secondary" type="button">
                    Cancel
                  </Button>
                </RouteFocusModal.Close>
              )}
              {next ? (
                <Button size="small" type="button" onClick={() => goTo(next)}>
                  Continue
                </Button>
              ) : (
                <Button size="small" type="submit" isLoading={create.isPending}>
                  Create brief
                </Button>
              )}
            </div>
          </RouteFocusModal.Footer>
        </ProgressTabs>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}
