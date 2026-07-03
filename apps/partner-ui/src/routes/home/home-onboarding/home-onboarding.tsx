import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Alert,
  Button,
  Heading,
  Input,
  ProgressTabs,
  RadioGroup,
  Select,
  Switch,
  Text,
  Textarea,
  clx,
  toast,
} from "@medusajs/ui"
import { LockClosedSolidMini } from "@medusajs/icons"
import { z } from "@medusajs/framework/zod"
import { useTranslation } from "react-i18next"

import {
  RouteFocusModal,
  useRouteModal,
} from "../../../components/modals"
import { KeyboundForm } from "../../../components/utilities/keybound-form"
import { useMe } from "../../../hooks/api/users"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"
import { OnboardingPlanStep } from "./onboarding-plan-step"

type Person = {
  first_name: string
  last_name: string
  email: string
}

type AboutYou = {
  business_name: string
  business_type: string
  description: string
  website: string
  phone: string
}

const personSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
})

// --- Onboarding profile (issue #648, slice 1) ---------------------------
// Mirrors the partner_onboarding_profile model / validator on the backend.
type PaymentCollection = "through_us" | "themselves"
// #859 S1 / #860 — how the partner sells.
type SellingMode = "dedicated_storefront" | "core_channel_listing"

type OnboardingProfile = {
  what_they_sell: string
  price_range: string
  person_type: string
  has_inventory_info: boolean
  does_stock: boolean
  does_weaving: boolean
  team_size: string // kept as string for the input; coerced to number on save
  payment_collection: PaymentCollection | ""
  selling_mode: SellingMode | ""
  commission_pct: string // % in the input; coerced to basis points on save
  // #859/#861 — orthogonal supplier capability (we place orders WITH them).
  supplies_to_platform: boolean
}

const WHAT_THEY_SELL_OPTIONS = [
  { value: "apparel", label: "Apparel / Garments" },
  { value: "home_textiles", label: "Home textiles" },
  { value: "fabric", label: "Fabric" },
  { value: "yarn", label: "Yarn" },
  { value: "accessories", label: "Accessories" },
  { value: "other", label: "Other" },
]

const PRICE_RANGE_OPTIONS = [
  { value: "economy", label: "Economy" },
  { value: "mid", label: "Mid-range" },
  { value: "premium", label: "Premium" },
  { value: "luxury", label: "Luxury" },
]

const PERSON_TYPE_OPTIONS = [
  { value: "individual", label: "Individual" },
  { value: "business", label: "Business" },
  { value: "manufacturer", label: "Manufacturer" },
  { value: "wholesaler", label: "Wholesaler" },
  { value: "retailer", label: "Retailer" },
  { value: "artisan", label: "Artisan" },
  { value: "other", label: "Other" },
]

const PAYMENT_COLLECTION_OPTIONS: { value: PaymentCollection; label: string }[] = [
  { value: "through_us", label: "Through JYT (we collect on your behalf)" },
  { value: "themselves", label: "Myself (I collect payments directly)" },
]

// #859 S1 / #860 — the two selling models presented on the "How you'll sell" step.
const SELLING_MODE_OPTIONS: {
  value: SellingMode
  label: string
  description: string
}[] = [
  {
    value: "dedicated_storefront",
    label: "Run my own storefront",
    description:
      "Your own branded store and sales channel. You manage your catalogue and checkout; JYT provides the platform.",
  },
  {
    value: "core_channel_listing",
    label: "List on the JYT marketplace",
    description:
      "Airbnb-style listing on the core cicilabel.com store. We verify and publish your products; you sell through our channel at an agreed commission.",
  },
]

const emptyProfile: OnboardingProfile = {
  what_they_sell: "",
  price_range: "",
  person_type: "",
  has_inventory_info: false,
  does_stock: false,
  does_weaving: false,
  team_size: "",
  payment_collection: "",
  selling_mode: "",
  commission_pct: "",
  supplies_to_platform: false,
}

const BUSINESS_TYPE_KEYS = [
  "manufacturer",
  "seller",
  "designer",
  "wholesaler",
  "artisan",
  "individual",
  "other",
] as const

const mapBusinessTypeToWorkspaceType = (businessType: string): "seller" | "manufacturer" | "individual" => {
  if (businessType === "seller") return "seller"
  if (businessType === "individual") return "individual"
  return "manufacturer"
}

// #859/#861 — "Selling" moved up to gate the rest of the wizard. Once the
// partner makes a selling choice (a selling_mode and/or the supplier switch),
// the dependent steps after it unlock.
const STEPS = ["about", "selling", "business", "operations", "logo", "people", "plan"] as const
type Step = (typeof STEPS)[number]

// The pivot step whose completion unlocks everything after it.
const GATE_STEP: Step = "selling"

// Onboarding country → billing currency. India bills in INR (PayU); everywhere
// else bills in EUR via Stripe (matches the seeded EUR launch plan). Curated
// list of common partner countries; extend as needed.
const COUNTRY_OPTIONS: { value: string; label: string }[] = [
  { value: "IN", label: "India" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "IT", label: "Italy" },
  { value: "ES", label: "Spain" },
  { value: "NL", label: "Netherlands" },
  { value: "BE", label: "Belgium" },
  { value: "AT", label: "Austria" },
  { value: "IE", label: "Ireland" },
  { value: "PT", label: "Portugal" },
  { value: "SE", label: "Sweden" },
  { value: "DK", label: "Denmark" },
  { value: "FI", label: "Finland" },
  { value: "PL", label: "Poland" },
  { value: "LV", label: "Latvia" },
  { value: "LT", label: "Lithuania" },
  { value: "EE", label: "Estonia" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "AE", label: "United Arab Emirates" },
]

const currencyForCountry = (countryCode: string): "inr" | "eur" =>
  countryCode === "IN" ? "inr" : "eur"

const getOnboardingStorageKey = (partnerId: string) =>
  `partner_onboarding_${partnerId}`

function getStepStatus(
  step: Step,
  currentStep: Step,
  aboutYou: AboutYou,
  hasLogo: boolean
): "not-started" | "in-progress" | "completed" {
  const currentIdx = STEPS.indexOf(currentStep)
  const stepIdx = STEPS.indexOf(step)
  if (step === currentStep) return "in-progress"
  if (stepIdx > currentIdx) return "not-started"
  if (step === "about") return aboutYou.business_name.trim() ? "completed" : "in-progress"
  if (step === "logo") return hasLogo ? "completed" : "in-progress"
  // Any earlier step the user has moved past counts as completed.
  if (stepIdx < currentIdx) return "completed"
  return "not-started"
}

export const HomeOnboarding = () => {
  return (
    <RouteFocusModal>
      <OnboardingForm />
    </RouteFocusModal>
  )
}

/**
 * Maps a workspace_type back to the closest business_type option for the dropdown.
 */
const mapWorkspaceTypeToBusinessType = (workspaceType?: string): string => {
  if (workspaceType === "seller") return "seller"
  if (workspaceType === "individual") return "individual"
  if (workspaceType === "manufacturer") return "manufacturer"
  return ""
}

const OnboardingForm = () => {
  const { t } = useTranslation()
  const { user } = useMe()
  const partnerId = user?.partner_id
  const partner = user?.partner
  const { handleSuccess } = useRouteModal()

  const STEP_LABELS: Record<Step, string> = {
    about: t("partner.onboardingModal.steps.about"),
    business: "Business",
    operations: "Operations",
    selling: "Selling",
    logo: t("partner.onboardingModal.steps.logo"),
    people: t("partner.onboardingModal.steps.people"),
    plan: "Plan",
  }

  const BUSINESS_TYPES = BUSINESS_TYPE_KEYS.map((key) => ({
    value: key,
    label: t(`partner.onboardingModal.businessTypes.${key}`),
  }))

  const storageKey = useMemo(
    () => (partnerId ? getOnboardingStorageKey(partnerId) : null),
    [partnerId]
  )

  // Hydrate initial state from partner metadata (server) + localStorage
  const savedState = useMemo(() => {
    if (!storageKey) return null
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }, [storageKey])

  const metadata = (partner?.metadata || {}) as Record<string, any>
  const workspaceType = (partner as any)?.workspace_type as string | undefined

  const [currentStep, setCurrentStep] = useState<Step>("about")
  const [aboutYou, setAboutYou] = useState<AboutYou>(() => ({
    business_name:
      savedState?.about?.business_name ||
      metadata.business_name ||
      partner?.name ||
      "",
    business_type:
      savedState?.about?.business_type ||
      mapWorkspaceTypeToBusinessType(workspaceType || metadata.use_type) ||
      "",
    description:
      savedState?.about?.description ||
      metadata.business_description ||
      "",
    website:
      savedState?.about?.website ||
      metadata.website ||
      "",
    phone:
      savedState?.about?.phone ||
      metadata.contact_phone ||
      "",
  }))
  const [countryCode, setCountryCode] = useState<string>(
    () =>
      savedState?.about?.country_code ||
      (partner as any)?.country_code ||
      metadata.country_code ||
      ""
  )
  // Billing currency the subscription is charged in — drives which plans show and
  // which payment provider the backend routes to (INR → PayU, EUR → Stripe).
  const currencyCode = useMemo(
    () =>
      countryCode
        ? currencyForCountry(countryCode)
        : (partner as any)?.currency_code || metadata.currency_code || "inr",
    [countryCode, partner, metadata]
  )
  const [logo, setLogo] = useState<File | null>(null)
  const [people, setPeople] = useState<Person[]>(() => {
    const saved = savedState?.people as Person[] | undefined
    if (saved && saved.length > 0) return saved
    return [{ first_name: "", last_name: "", email: "" }]
  })
  const [profile, setProfile] = useState<OnboardingProfile>(emptyProfile)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success] = useState(false)

  // Hydrate the onboarding profile from the server if the partner has
  // started the wizard before (returning users / resumed onboarding).
  useEffect(() => {
    let cancelled = false
    if (!partnerId) return
    ;(async () => {
      try {
        const res = (await sdk.client.fetch(
          "/partners/onboarding-profile"
        )) as { onboarding_profile?: Record<string, any> | null }
        const p = res?.onboarding_profile
        if (!p || cancelled) return
        setProfile((prev) => ({
          ...prev,
          what_they_sell: p.what_they_sell ?? prev.what_they_sell,
          price_range: p.price_range ?? prev.price_range,
          person_type: p.person_type ?? prev.person_type,
          has_inventory_info: Boolean(p.has_inventory_info),
          does_stock: Boolean(p.does_stock),
          does_weaving: Boolean(p.does_weaving),
          team_size:
            p.team_size === null || p.team_size === undefined
              ? prev.team_size
              : String(p.team_size),
          payment_collection: (p.payment_collection ??
            prev.payment_collection) as PaymentCollection | "",
          selling_mode: (p.selling_mode ?? prev.selling_mode) as SellingMode | "",
          commission_pct:
            p.commission_bps === null || p.commission_bps === undefined
              ? prev.commission_pct
              : String(p.commission_bps / 100),
          supplies_to_platform: Boolean(p.supplies_to_platform),
        }))
      } catch {
        // non-blocking — first-time partners have no profile yet
      }
    })()
    return () => {
      cancelled = true
    }
  }, [partnerId])

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setLogo(file)
  }

  const handlePersonChange = (
    index: number,
    field: keyof Person,
    value: string
  ) => {
    setPeople((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  const addPerson = () => {
    setPeople((prev) => [
      ...prev,
      { first_name: "", last_name: "", email: "" },
    ])
  }

  const removePerson = (index: number) => {
    setPeople((prev) => {
      if (prev.length <= 1) return prev
      const updated = [...prev]
      updated.splice(index, 1)
      return updated
    })
  }

  const validatePeople = () => {
    const filled = people.filter(
      (p) => p.first_name.trim() || p.last_name.trim() || p.email.trim()
    )
    if (filled.length === 0) return true
    for (const person of filled) {
      const result = personSchema.safeParse(person)
      if (!result.success) {
        const firstError = result.error.issues[0]
        setError(`${firstError.path.join(".")} - ${firstError.message}`)
        return false
      }
    }
    return true
  }

  const currentIdx = STEPS.indexOf(currentStep)
  const isFirstStep = currentIdx === 0
  const isLastStep = currentIdx === STEPS.length - 1

  // #859/#861 — gating. The Selling step must be answered — a selling_mode
  // and/or the supplier switch — before the dependent steps unlock.
  const gateIdx = STEPS.indexOf(GATE_STEP)
  const sellingSatisfied =
    profile.selling_mode !== "" || profile.supplies_to_platform === true
  const isStepLocked = useCallback(
    (step: Step) => STEPS.indexOf(step) > gateIdx && !sellingSatisfied,
    [gateIdx, sellingSatisfied]
  )
  // Blocks "Continue" while sitting on the gate step with nothing chosen.
  const nextIsLocked = currentStep === GATE_STEP && !sellingSatisfied

  const goNext = useCallback(() => {
    const idx = STEPS.indexOf(currentStep)
    if (idx >= STEPS.length - 1) return
    const next = STEPS[idx + 1]
    // Don't step into a locked (dependent) step before the gate is satisfied.
    if (STEPS.indexOf(next) > gateIdx && !sellingSatisfied) return
    setCurrentStep(next)
  }, [currentStep, gateIdx, sellingSatisfied])

  const goBack = useCallback(() => {
    const idx = STEPS.indexOf(currentStep)
    if (idx > 0) setCurrentStep(STEPS[idx - 1])
  }, [currentStep])

  const handleSkip = () => {
    try {
      if (storageKey) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            completed: false,
            skipped: true,
            about: aboutYou,
            people: [],
            logo: null,
            skipped_at: new Date().toISOString(),
          })
        )
      }
    } finally {
      handleSuccess("/")
    }
  }

  // Persist all onboarding data (partner update + profile + wizard snapshot)
  // WITHOUT navigating. Returns false on a validation error. Used both by the
  // final "finish" action and by the plan step (which must save before a paid
  // plan redirects the browser away to the payment page).
  const persistOnboarding = async (): Promise<boolean> => {
    if (!validatePeople()) return false
    setError(null)

    try {
      const updateBody: Record<string, any> = {}
      const metadataUpdate: Record<string, any> = {}

      if (aboutYou.business_type) {
        updateBody.workspace_type = mapBusinessTypeToWorkspaceType(aboutYou.business_type)
      }
      // Billing locale → typed columns (drive subscription provider routing).
      if (countryCode) {
        updateBody.country_code = countryCode
        updateBody.currency_code = currencyCode
      }
      if (aboutYou.business_name) metadataUpdate.business_name = aboutYou.business_name
      if (aboutYou.description) metadataUpdate.business_description = aboutYou.description
      if (aboutYou.website) metadataUpdate.website = aboutYou.website
      if (aboutYou.phone) metadataUpdate.contact_phone = aboutYou.phone

      if (Object.keys(metadataUpdate).length > 0) {
        updateBody.metadata = metadataUpdate
      }

      if (Object.keys(updateBody).length > 0) {
        try {
          await sdk.client.fetch("/partners/update", {
            method: "PUT",
            body: updateBody,
          })
          queryClient.invalidateQueries({ queryKey: ["users", "me"] })
        } catch {
          // non-blocking
        }
      }

      // Persist the onboarding profile (#648 slice 1). Only send fields the
      // partner actually set; booleans always go through.
      const profileBody: Record<string, any> = {
        has_inventory_info: profile.has_inventory_info,
        does_stock: profile.does_stock,
        does_weaving: profile.does_weaving,
        completed: true,
      }
      if (profile.what_they_sell) profileBody.what_they_sell = profile.what_they_sell
      if (profile.price_range) profileBody.price_range = profile.price_range
      if (profile.person_type) profileBody.person_type = profile.person_type
      if (profile.payment_collection)
        profileBody.payment_collection = profile.payment_collection
      if (profile.team_size.trim() !== "") {
        const n = Number.parseInt(profile.team_size, 10)
        if (Number.isFinite(n)) profileBody.team_size = n
      }
      // #859 S1 / #860 — selling mode + agreed commission (% → basis points).
      if (profile.selling_mode) profileBody.selling_mode = profile.selling_mode
      if (
        profile.selling_mode === "core_channel_listing" &&
        profile.commission_pct.trim() !== ""
      ) {
        const pct = Number.parseFloat(profile.commission_pct)
        if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
          profileBody.commission_bps = Math.round(pct * 100)
        }
      }
      // #859/#861 — supplier capability (orthogonal; always sent).
      profileBody.supplies_to_platform = profile.supplies_to_platform

      try {
        await sdk.client.fetch("/partners/onboarding-profile", {
          method: "PUT",
          body: profileBody,
        })
      } catch {
        // non-blocking — wizard state is also kept in localStorage below
      }

      const filledPeople = people.filter(
        (p) => p.first_name.trim() && p.last_name.trim() && p.email.trim()
      )

      if (storageKey) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            completed: true,
            skipped: false,
            about: { ...aboutYou, country_code: countryCode },
            people: filledPeople,
            logo: logo ? { name: logo.name, type: logo.type, size: logo.size } : null,
            completed_at: new Date().toISOString(),
          })
        )
      }

      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : t("partner.onboardingModal.errors.unknown"))
      return false
    }
  }

  // Finish onboarding without picking a paid plan here (free / choose later).
  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const ok = await persistOnboarding()
      if (!ok) return
      toast.success(t("partner.onboardingModal.toast.completed"))
      handleSuccess("/")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ProgressTabs
      value={currentStep}
      onValueChange={(v) => {
        const step = v as Step
        if (isStepLocked(step)) return // locked until the Selling step is answered
        setCurrentStep(step)
      }}
      className="flex h-full flex-col overflow-hidden"
    >
      <KeyboundForm
        onSubmit={(e) => {
          e.preventDefault()
          if (isLastStep) {
            handleSubmit()
          } else {
            goNext()
          }
        }}
        className="flex h-full flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div className="-my-2 w-full border-l">
            <ProgressTabs.List>
              {STEPS.map((step) => (
                <ProgressTabs.Trigger
                  key={step}
                  value={step}
                  disabled={isStepLocked(step)}
                  status={getStepStatus(step, currentStep, aboutYou, !!logo || !!partner?.logo)}
                  className="w-full max-w-[200px]"
                >
                  <span className="flex items-center gap-x-1.5">
                    {isStepLocked(step) && (
                      <LockClosedSolidMini className="text-ui-fg-muted" />
                    )}
                    {STEP_LABELS[step]}
                  </span>
                </ProgressTabs.Trigger>
              ))}
            </ProgressTabs.List>
          </div>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="overflow-auto">
          {/* Step 1: About You */}
          <ProgressTabs.Content value="about" className="p-6">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-4 py-10">
              <div>
                <Heading>{t("partner.onboardingModal.about.heading")}</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  {t("partner.onboardingModal.about.description")}
                </Text>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Text size="small" className="mb-1 block font-medium">
                    {t("partner.onboardingModal.about.businessName")}
                  </Text>
                  <Input
                    value={aboutYou.business_name}
                    onChange={(e) =>
                      setAboutYou((prev) => ({ ...prev, business_name: e.target.value }))
                    }
                    placeholder={t("partner.onboardingModal.about.businessNamePlaceholder")}
                  />
                </div>

                <div className="md:col-span-2">
                  <Text size="small" className="mb-1 block font-medium">
                    {t("partner.onboardingModal.about.businessTypeLabel")}
                  </Text>
                  <Select
                    value={aboutYou.business_type}
                    onValueChange={(v) =>
                      setAboutYou((prev) => ({ ...prev, business_type: v }))
                    }
                  >
                    <Select.Trigger>
                      <Select.Value placeholder={t("partner.onboardingModal.about.businessTypePlaceholder")} />
                    </Select.Trigger>
                    <Select.Content>
                      {BUSINESS_TYPES.map((bt) => (
                        <Select.Item key={bt.value} value={bt.value}>
                          {bt.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>

                <div className="md:col-span-2">
                  <Text size="small" className="mb-1 block font-medium">
                    Country
                  </Text>
                  <Select
                    value={countryCode}
                    onValueChange={(v) => setCountryCode(v)}
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select your country" />
                    </Select.Trigger>
                    <Select.Content>
                      {COUNTRY_OPTIONS.map((c) => (
                        <Select.Item key={c.value} value={c.value}>
                          {c.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                  {countryCode && (
                    <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                      {currencyCode === "inr"
                        ? "Billed in ₹ (INR) via PayU."
                        : "Billed in € (EUR) via Stripe."}
                    </Text>
                  )}
                </div>

                <div className="md:col-span-2">
                  <Text size="small" className="mb-1 block font-medium">
                    {t("partner.onboardingModal.about.descriptionLabel")}
                  </Text>
                  <Textarea
                    value={aboutYou.description}
                    onChange={(e) =>
                      setAboutYou((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder={t("partner.onboardingModal.about.descriptionPlaceholder")}
                    rows={3}
                  />
                </div>

                <div>
                  <Text size="small" className="mb-1 block font-medium">
                    {t("partner.onboardingModal.about.website")}{" "}
                    <span className="text-ui-fg-muted font-normal">
                      {t("partner.onboardingModal.about.optional")}
                    </span>
                  </Text>
                  <Input
                    value={aboutYou.website}
                    onChange={(e) =>
                      setAboutYou((prev) => ({ ...prev, website: e.target.value }))
                    }
                    placeholder={t("partner.onboardingModal.about.websitePlaceholder")}
                    type="url"
                  />
                </div>

                <div>
                  <Text size="small" className="mb-1 block font-medium">
                    {t("partner.onboardingModal.about.phone")}{" "}
                    <span className="text-ui-fg-muted font-normal">
                      {t("partner.onboardingModal.about.optional")}
                    </span>
                  </Text>
                  <Input
                    value={aboutYou.phone}
                    onChange={(e) =>
                      setAboutYou((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    placeholder={t("partner.onboardingModal.about.phonePlaceholder")}
                    type="tel"
                  />
                </div>
              </div>
            </div>
          </ProgressTabs.Content>

          {/* Step 2: Business profile */}
          <ProgressTabs.Content value="business" className="p-6">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-4 py-10">
              <div>
                <Heading>Your business</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Tell us a bit about what you sell so we can tailor your workspace.
                </Text>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Text size="small" className="mb-1 block font-medium">
                    What do you sell?
                  </Text>
                  <Select
                    value={profile.what_they_sell}
                    onValueChange={(v) =>
                      setProfile((prev) => ({ ...prev, what_they_sell: v }))
                    }
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select a category" />
                    </Select.Trigger>
                    <Select.Content>
                      {WHAT_THEY_SELL_OPTIONS.map((o) => (
                        <Select.Item key={o.value} value={o.value}>
                          {o.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>

                <div>
                  <Text size="small" className="mb-1 block font-medium">
                    Typical price range
                  </Text>
                  <Select
                    value={profile.price_range}
                    onValueChange={(v) =>
                      setProfile((prev) => ({ ...prev, price_range: v }))
                    }
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select a price band" />
                    </Select.Trigger>
                    <Select.Content>
                      {PRICE_RANGE_OPTIONS.map((o) => (
                        <Select.Item key={o.value} value={o.value}>
                          {o.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>

                <div className="md:col-span-2">
                  <Text size="small" className="mb-1 block font-medium">
                    What kind of partner are you?
                  </Text>
                  <Select
                    value={profile.person_type}
                    onValueChange={(v) =>
                      setProfile((prev) => ({ ...prev, person_type: v }))
                    }
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select a type" />
                    </Select.Trigger>
                    <Select.Content>
                      {PERSON_TYPE_OPTIONS.map((o) => (
                        <Select.Item key={o.value} value={o.value}>
                          {o.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
              </div>
            </div>
          </ProgressTabs.Content>

          {/* Step 3: Operations */}
          <ProgressTabs.Content value="operations" className="p-6">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-4 py-10">
              <div>
                <Heading>How you operate</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  This helps us set up inventory, production and payments for you.
                </Text>
              </div>

              <div className="flex flex-col gap-y-3">
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <Text size="small" weight="plus">
                      Do you keep inventory information?
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      You track stock counts, SKUs or product catalogues.
                    </Text>
                  </div>
                  <Switch
                    checked={profile.has_inventory_info}
                    onCheckedChange={(c) =>
                      setProfile((prev) => ({ ...prev, has_inventory_info: c }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <Text size="small" weight="plus">
                      Do you hold stock?
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      You carry physical stock yourself.
                    </Text>
                  </div>
                  <Switch
                    checked={profile.does_stock}
                    onCheckedChange={(c) =>
                      setProfile((prev) => ({ ...prev, does_stock: c }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <Text size="small" weight="plus">
                      Do you do weaving?
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      You produce woven textiles in-house.
                    </Text>
                  </div>
                  <Switch
                    checked={profile.does_weaving}
                    onCheckedChange={(c) =>
                      setProfile((prev) => ({ ...prev, does_weaving: c }))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Text size="small" className="mb-1 block font-medium">
                    Team size{" "}
                    <span className="text-ui-fg-muted font-normal">(optional)</span>
                  </Text>
                  <Input
                    value={profile.team_size}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        team_size: e.target.value.replace(/[^0-9]/g, ""),
                      }))
                    }
                    placeholder="e.g. 8"
                    inputMode="numeric"
                  />
                </div>

                <div>
                  <Text size="small" className="mb-1 block font-medium">
                    How are payments collected?
                  </Text>
                  <Select
                    value={profile.payment_collection}
                    onValueChange={(v) =>
                      setProfile((prev) => ({
                        ...prev,
                        payment_collection: v as PaymentCollection,
                      }))
                    }
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select an option" />
                    </Select.Trigger>
                    <Select.Content>
                      {PAYMENT_COLLECTION_OPTIONS.map((o) => (
                        <Select.Item key={o.value} value={o.value}>
                          {o.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
              </div>
            </div>
          </ProgressTabs.Content>

          {/* Step 4: How you'll sell (#859 S1 / #860) */}
          <ProgressTabs.Content value="selling" className="p-6">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-4 py-10">
              <div>
                <Heading>How you'll sell</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Choose whether you want your own storefront, or to list on the
                  JYT marketplace. You can change this later with our team.
                </Text>
              </div>

              <RadioGroup
                value={profile.selling_mode}
                onValueChange={(v) =>
                  setProfile((prev) => ({
                    ...prev,
                    selling_mode: v as SellingMode,
                  }))
                }
                className="flex flex-col gap-y-3"
              >
                {SELLING_MODE_OPTIONS.map((o) => {
                  const selected = profile.selling_mode === o.value
                  return (
                    <label
                      key={o.value}
                      htmlFor={`selling-${o.value}`}
                      className={clx(
                        "flex cursor-pointer items-start gap-x-3 rounded-lg border px-4 py-3 transition-colors",
                        {
                          "border-ui-border-interactive bg-ui-bg-base-pressed":
                            selected,
                          "hover:bg-ui-bg-base-hover": !selected,
                        }
                      )}
                    >
                      <RadioGroup.Item
                        value={o.value}
                        id={`selling-${o.value}`}
                        className="mt-0.5"
                      />
                      <div>
                        <Text size="small" weight="plus">
                          {o.label}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {o.description}
                        </Text>
                      </div>
                    </label>
                  )
                })}
              </RadioGroup>

              {profile.selling_mode === "core_channel_listing" && (
                <div className="rounded-lg border px-4 py-3">
                  <Text size="small" className="mb-1 block font-medium">
                    Agreed commission{" "}
                    <span className="text-ui-fg-muted font-normal">(%)</span>
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle mb-2 block">
                    The revenue-share JYT keeps on each marketplace sale. Leave
                    blank to use the platform default.
                  </Text>
                  <div className="flex max-w-[160px] items-center gap-x-2">
                    <Input
                      value={profile.commission_pct}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          commission_pct: e.target.value.replace(
                            /[^0-9.]/g,
                            ""
                          ),
                        }))
                      }
                      placeholder="e.g. 20"
                      inputMode="decimal"
                    />
                    <Text size="small" className="text-ui-fg-subtle">
                      %
                    </Text>
                  </div>
                </div>
              )}

              {/* #859/#861 — supplier capability. Orthogonal to the selling
                  choice above: a partner can list on the marketplace AND supply
                  us, or be a supplier only. */}
              <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                <div className="pr-4">
                  <Text size="small" weight="plus">
                    We also order from you (supplier)
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Turn this on if JYT places production / inventory orders with
                    you — e.g. a handloom supplier or manufacturer. You can pick
                    this alongside a selling option above, or on its own.
                  </Text>
                </div>
                <Switch
                  className="shrink-0"
                  checked={profile.supplies_to_platform}
                  onCheckedChange={(c) =>
                    setProfile((prev) => ({ ...prev, supplies_to_platform: c }))
                  }
                />
              </div>

              {!sellingSatisfied && (
                <Alert variant="warning">
                  Choose how you'll sell — or turn on the supplier option — to
                  unlock the rest of onboarding.
                </Alert>
              )}
            </div>
          </ProgressTabs.Content>

          {/* Step 5: Logo */}
          <ProgressTabs.Content value="logo" className="p-6">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-4 py-10">
              <div>
                <Heading>{t("partner.onboardingModal.logo.heading")}</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  {t("partner.onboardingModal.logo.description")}
                </Text>
              </div>
              <div className="flex w-full flex-grow items-center justify-center">
                <label className="bg-ui-bg-subtle hover:bg-ui-bg-base-pressed flex h-64 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors">
                  <div className="flex flex-col items-center justify-center pb-6 pt-5">
                    {logo ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-ui-bg-base border">
                          <Text size="small" weight="plus">
                            {logo.name.split(".").pop()?.toUpperCase()}
                          </Text>
                        </div>
                        <Text size="small" className="text-ui-fg-base font-medium">
                          {logo.name}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("partner.onboardingModal.logo.clickToChange")}
                        </Text>
                      </div>
                    ) : partner?.logo ? (
                      <div className="flex flex-col items-center gap-2">
                        <img
                          src={partner.logo}
                          alt={t("partner.onboardingModal.logo.currentLogo")}
                          className="h-16 w-16 rounded-lg border object-cover"
                        />
                        <Text size="small" className="text-ui-fg-base font-medium">
                          {t("partner.onboardingModal.logo.currentLogo")}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("partner.onboardingModal.logo.clickToChange")}
                        </Text>
                      </div>
                    ) : (
                      <>
                        <Text size="small" className="text-ui-fg-subtle mb-2">
                          {t("partner.onboardingModal.logo.clickToUpload")}
                        </Text>
                        <Text size="small" className="text-ui-fg-muted">
                          {t("partner.onboardingModal.logo.fileTypes")}
                        </Text>
                      </>
                    )}
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={handleLogoChange}
                  />
                </label>
              </div>
            </div>
          </ProgressTabs.Content>

          {/* Step 6: Team */}
          <ProgressTabs.Content value="people" className="p-6">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-4 py-10">
              <div>
                <Heading>{t("partner.onboardingModal.team.heading")}</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  {t("partner.onboardingModal.team.description")}
                </Text>
              </div>

              {error && <Alert variant="error">{error}</Alert>}
              {success && (
                <Alert variant="success">{t("partner.onboardingModal.team.success")}</Alert>
              )}

              <div className="flex-grow space-y-4">
                {people.map((person, index) => (
                  <div
                    key={String(index)}
                    className="grid grid-cols-1 gap-4 rounded-lg border p-4 md:grid-cols-3"
                  >
                    <div>
                      <Text size="small" className="mb-1 block">
                        {t("partner.onboardingModal.team.firstName")}
                      </Text>
                      <Input
                        value={person.first_name}
                        onChange={(e) => handlePersonChange(index, "first_name", e.target.value)}
                        placeholder={t("partner.onboardingModal.team.firstNamePlaceholder")}
                      />
                    </div>
                    <div>
                      <Text size="small" className="mb-1 block">
                        {t("partner.onboardingModal.team.lastName")}
                      </Text>
                      <Input
                        value={person.last_name}
                        onChange={(e) => handlePersonChange(index, "last_name", e.target.value)}
                        placeholder={t("partner.onboardingModal.team.lastNamePlaceholder")}
                      />
                    </div>
                    <div>
                      <Text size="small" className="mb-1 block">
                        {t("partner.onboardingModal.team.email")}
                      </Text>
                      <Input
                        value={person.email}
                        onChange={(e) => handlePersonChange(index, "email", e.target.value)}
                        placeholder={t("partner.onboardingModal.team.emailPlaceholder")}
                        type="email"
                      />
                    </div>
                    {people.length > 1 && (
                      <div className="flex justify-end md:col-span-3">
                        <Button variant="danger" size="small" onClick={() => removePerson(index)}>
                          {t("partner.onboardingModal.team.remove")}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <Button variant="secondary" onClick={addPerson} className="w-full">
                {t("partner.onboardingModal.team.addAnother")}
              </Button>
            </div>
          </ProgressTabs.Content>

          {/* Step 7: Plan */}
          <ProgressTabs.Content value="plan" className="p-6">
            {error && (
              <div className="mx-auto w-full max-w-[820px] pt-6">
                <Alert variant="error">{error}</Alert>
              </div>
            )}
            <OnboardingPlanStep
              currencyCode={currencyCode}
              onBeforeSelect={persistOnboarding}
              onFreeActivated={() => {
                toast.success(t("partner.onboardingModal.toast.completed"))
                handleSuccess("/")
              }}
            />
          </ProgressTabs.Content>
        </RouteFocusModal.Body>

        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <Button variant="secondary" size="small" onClick={handleSkip}>
              {isFirstStep
                ? t("partner.onboardingModal.footer.skipShort")
                : t("partner.onboardingModal.footer.skip")}
            </Button>
            {!isFirstStep && (
              <Button variant="secondary" size="small" type="button" onClick={goBack}>
                {t("partner.onboardingModal.footer.back")}
              </Button>
            )}
            {isLastStep ? (
              <Button
                size="small"
                variant="primary"
                type="submit"
                isLoading={isSubmitting}
                disabled={isSubmitting}
              >
                {t("partner.onboardingModal.footer.complete")}
              </Button>
            ) : (
              <Button
                size="small"
                variant="primary"
                type="submit"
                disabled={nextIsLocked}
              >
                {t("partner.onboardingModal.footer.continue")}
              </Button>
            )}
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </ProgressTabs>
  )
}
