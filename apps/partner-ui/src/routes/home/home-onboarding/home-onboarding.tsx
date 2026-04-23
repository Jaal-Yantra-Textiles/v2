import { useCallback, useMemo, useState } from "react"
import {
  Alert,
  Button,
  Heading,
  Input,
  ProgressTabs,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
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

const STEPS = ["about", "logo", "people"] as const
type Step = (typeof STEPS)[number]

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
    logo: t("partner.onboardingModal.steps.logo"),
    people: t("partner.onboardingModal.steps.people"),
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
  const [logo, setLogo] = useState<File | null>(null)
  const [people, setPeople] = useState<Person[]>(() => {
    const saved = savedState?.people as Person[] | undefined
    if (saved && saved.length > 0) return saved
    return [{ first_name: "", last_name: "", email: "" }]
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success] = useState(false)

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
        const firstError = result.error.errors[0]
        setError(`${firstError.path.join(".")} - ${firstError.message}`)
        return false
      }
    }
    return true
  }

  const currentIdx = STEPS.indexOf(currentStep)
  const isFirstStep = currentIdx === 0
  const isLastStep = currentIdx === STEPS.length - 1

  const goNext = useCallback(() => {
    const idx = STEPS.indexOf(currentStep)
    if (idx < STEPS.length - 1) setCurrentStep(STEPS[idx + 1])
  }, [currentStep])

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

  const handleSubmit = async () => {
    if (!validatePeople()) return

    setIsSubmitting(true)
    setError(null)

    try {
      const updateBody: Record<string, any> = {}
      const metadataUpdate: Record<string, any> = {}

      if (aboutYou.business_type) {
        updateBody.workspace_type = mapBusinessTypeToWorkspaceType(aboutYou.business_type)
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

      const filledPeople = people.filter(
        (p) => p.first_name.trim() && p.last_name.trim() && p.email.trim()
      )

      if (storageKey) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            completed: true,
            skipped: false,
            about: aboutYou,
            people: filledPeople,
            logo: logo ? { name: logo.name, type: logo.type, size: logo.size } : null,
            completed_at: new Date().toISOString(),
          })
        )
      }

      toast.success(t("partner.onboardingModal.toast.completed"))
      handleSuccess("/")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("partner.onboardingModal.errors.unknown"))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ProgressTabs
      value={currentStep}
      onValueChange={(v) => setCurrentStep(v as Step)}
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
                  status={getStepStatus(step, currentStep, aboutYou, !!logo || !!partner?.logo)}
                  className="w-full max-w-[200px]"
                >
                  {STEP_LABELS[step]}
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

          {/* Step 2: Logo */}
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

          {/* Step 3: Team */}
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
              <Button size="small" variant="primary" type="submit">
                {t("partner.onboardingModal.footer.continue")}
              </Button>
            )}
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </ProgressTabs>
  )
}
