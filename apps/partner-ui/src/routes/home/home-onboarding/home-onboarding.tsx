import { useCallback, useEffect, useMemo, useState } from "react"
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

const BUSINESS_TYPES = [
  { value: "manufacturer", label: "Manufacturer / Producer" },
  { value: "seller", label: "Seller / Retailer" },
  { value: "designer", label: "Designer / Creator" },
  { value: "wholesaler", label: "Wholesaler / Distributor" },
  { value: "artisan", label: "Artisan / Craftsperson" },
  { value: "other", label: "Other" },
]

const STEPS = ["about", "logo", "people"] as const
type Step = (typeof STEPS)[number]

const STEP_LABELS: Record<Step, string> = {
  about: "About You",
  logo: "Logo & Brand",
  people: "Team",
}

const getOnboardingStorageKey = (partnerId: string) =>
  `partner_onboarding_${partnerId}`

function getStepStatus(
  step: Step,
  currentStep: Step,
  aboutYou: AboutYou,
  logo: File | null
): "not-started" | "in-progress" | "completed" {
  const currentIdx = STEPS.indexOf(currentStep)
  const stepIdx = STEPS.indexOf(step)
  if (step === currentStep) return "in-progress"
  if (stepIdx > currentIdx) return "not-started"
  if (step === "about") return aboutYou.business_name.trim() ? "completed" : "in-progress"
  if (step === "logo") return logo ? "completed" : "in-progress"
  return "not-started"
}

export const HomeOnboarding = () => {
  return (
    <RouteFocusModal>
      <OnboardingForm />
    </RouteFocusModal>
  )
}

const OnboardingForm = () => {
  const { user } = useMe()
  const partnerId = user?.partner_id
  const { handleSuccess } = useRouteModal()

  const storageKey = useMemo(
    () => (partnerId ? getOnboardingStorageKey(partnerId) : null),
    [partnerId]
  )

  const [currentStep, setCurrentStep] = useState<Step>("about")
  const [aboutYou, setAboutYou] = useState<AboutYou>({
    business_name: "",
    business_type: "",
    description: "",
    website: "",
    phone: "",
  })
  const [logo, setLogo] = useState<File | null>(null)
  const [people, setPeople] = useState<Person[]>([
    { first_name: "", last_name: "", email: "" },
  ])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

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
      const metadataUpdate: Record<string, any> = {}
      if (aboutYou.business_type) {
        metadataUpdate.use_type =
          aboutYou.business_type === "seller" ? "seller" : "manufacturer"
      }
      if (aboutYou.business_name) metadataUpdate.business_name = aboutYou.business_name
      if (aboutYou.description) metadataUpdate.business_description = aboutYou.description
      if (aboutYou.website) metadataUpdate.website = aboutYou.website
      if (aboutYou.phone) metadataUpdate.contact_phone = aboutYou.phone

      if (Object.keys(metadataUpdate).length > 0) {
        try {
          await sdk.client.fetch("/partners/update", {
            method: "PUT",
            body: { metadata: metadataUpdate },
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

      toast.success("Onboarding completed")
      handleSuccess("/")
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unknown error occurred")
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
                  status={getStepStatus(step, currentStep, aboutYou, logo)}
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
                <Heading>Tell us about your business</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  This helps us customize your experience and connect you with
                  the right tools.
                </Text>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Text size="small" className="mb-1 block font-medium">
                    Business name
                  </Text>
                  <Input
                    value={aboutYou.business_name}
                    onChange={(e) =>
                      setAboutYou((prev) => ({ ...prev, business_name: e.target.value }))
                    }
                    placeholder="Acme Textiles"
                  />
                </div>

                <div className="md:col-span-2">
                  <Text size="small" className="mb-1 block font-medium">
                    What best describes your business?
                  </Text>
                  <Select
                    value={aboutYou.business_type}
                    onValueChange={(v) =>
                      setAboutYou((prev) => ({ ...prev, business_type: v }))
                    }
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select business type" />
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
                    Brief description
                  </Text>
                  <Textarea
                    value={aboutYou.description}
                    onChange={(e) =>
                      setAboutYou((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder="What do you make or sell? Who are your customers?"
                    rows={3}
                  />
                </div>

                <div>
                  <Text size="small" className="mb-1 block font-medium">
                    Website{" "}
                    <span className="text-ui-fg-muted font-normal">(optional)</span>
                  </Text>
                  <Input
                    value={aboutYou.website}
                    onChange={(e) =>
                      setAboutYou((prev) => ({ ...prev, website: e.target.value }))
                    }
                    placeholder="https://acmetextiles.com"
                    type="url"
                  />
                </div>

                <div>
                  <Text size="small" className="mb-1 block font-medium">
                    Phone{" "}
                    <span className="text-ui-fg-muted font-normal">(optional)</span>
                  </Text>
                  <Input
                    value={aboutYou.phone}
                    onChange={(e) =>
                      setAboutYou((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    placeholder="+91 98765 43210"
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
                <Heading>Upload your company logo</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  This will appear on your partner profile and storefront.
                  You can always change this later.
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
                          Click to change
                        </Text>
                      </div>
                    ) : (
                      <>
                        <Text size="small" className="text-ui-fg-subtle mb-2">
                          Click to upload or drag and drop
                        </Text>
                        <Text size="small" className="text-ui-fg-muted">
                          SVG, PNG, JPG (MAX. 5MB)
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
                <Heading>Add your team members</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Invite people who will help manage your store and products.
                  This step is optional — you can add team members later.
                </Text>
              </div>

              {error && <Alert variant="error">{error}</Alert>}
              {success && (
                <Alert variant="success">Onboarding completed!</Alert>
              )}

              <div className="flex-grow space-y-4">
                {people.map((person, index) => (
                  <div
                    key={String(index)}
                    className="grid grid-cols-1 gap-4 rounded-lg border p-4 md:grid-cols-3"
                  >
                    <div>
                      <Text size="small" className="mb-1 block">First Name</Text>
                      <Input
                        value={person.first_name}
                        onChange={(e) => handlePersonChange(index, "first_name", e.target.value)}
                        placeholder="John"
                      />
                    </div>
                    <div>
                      <Text size="small" className="mb-1 block">Last Name</Text>
                      <Input
                        value={person.last_name}
                        onChange={(e) => handlePersonChange(index, "last_name", e.target.value)}
                        placeholder="Doe"
                      />
                    </div>
                    <div>
                      <Text size="small" className="mb-1 block">Email</Text>
                      <Input
                        value={person.email}
                        onChange={(e) => handlePersonChange(index, "email", e.target.value)}
                        placeholder="john@company.com"
                        type="email"
                      />
                    </div>
                    {people.length > 1 && (
                      <div className="flex justify-end md:col-span-3">
                        <Button variant="danger" size="small" onClick={() => removePerson(index)}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <Button variant="secondary" onClick={addPerson} className="w-full">
                + Add Another Person
              </Button>
            </div>
          </ProgressTabs.Content>
        </RouteFocusModal.Body>

        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <Button variant="secondary" size="small" onClick={handleSkip}>
              {isFirstStep ? "Skip" : "Skip for now"}
            </Button>
            {!isFirstStep && (
              <Button variant="secondary" size="small" type="button" onClick={goBack}>
                Back
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
                Complete Setup
              </Button>
            ) : (
              <Button size="small" variant="primary" type="submit">
                Continue
              </Button>
            )}
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </ProgressTabs>
  )
}
