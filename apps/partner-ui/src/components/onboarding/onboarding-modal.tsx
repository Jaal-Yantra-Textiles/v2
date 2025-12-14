import { useEffect, useMemo, useState } from "react"
import {
  Alert,
  Button,
  FocusModal,
  Heading,
  Input,
  ProgressTabs,
  Text,
} from "@medusajs/ui"
import { z } from "zod"

type Person = {
  first_name: string
  last_name: string
  email: string
}

const personSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
})

type OnboardingModalProps = {
  partnerId: string
  isOpen: boolean
  onClose: () => void
}

const getOnboardingStorageKey = (partnerId: string) =>
  `partner_onboarding_${partnerId}`

export const OnboardingModal = ({
  partnerId,
  isOpen,
  onClose,
}: OnboardingModalProps) => {
  const storageKey = useMemo(() => getOnboardingStorageKey(partnerId), [partnerId])

  const [currentStep, setCurrentStep] = useState("logo")
  const [logo, setLogo] = useState<File | null>(null)
  const [people, setPeople] = useState<Person[]>([
    { first_name: "", last_name: "", email: "" },
  ])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setCurrentStep("logo")
      setError(null)
      setSuccess(false)
    }
  }, [isOpen])

  const handleSkip = () => {
    try {
      const payload = {
        completed: false,
        skipped: true,
        people: [],
        logo: null,
        skipped_at: new Date().toISOString(),
      }
      localStorage.setItem(storageKey, JSON.stringify(payload))
    } finally {
      onClose()
    }
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setLogo(file)
    }
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
    setPeople((prev) => [...prev, { first_name: "", last_name: "", email: "" }])
  }

  const removePerson = (index: number) => {
    setPeople((prev) => {
      if (prev.length <= 1) {
        return prev
      }
      const updated = [...prev]
      updated.splice(index, 1)
      return updated
    })
  }

  const validatePeople = () => {
    for (const person of people) {
      const result = personSchema.safeParse(person)
      if (!result.success) {
        const firstError = result.error.errors[0]
        setError(`${firstError.path.join(".")} - ${firstError.message}`)
        return false
      }
    }

    return true
  }

  const handleSubmit = async () => {
    if (!validatePeople()) {
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const payload = {
        completed: true,
        skipped: false,
        people,
        logo: logo ? { name: logo.name, type: logo.type, size: logo.size } : null,
        completed_at: new Date().toISOString(),
      }

      localStorage.setItem(storageKey, JSON.stringify(payload))

      setSuccess(true)
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unknown error occurred")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <FocusModal open={isOpen} onOpenChange={(open) => (!open ? onClose() : null)}>
      <FocusModal.Content>
        <FocusModal.Header>
          <FocusModal.Title asChild>
            <Heading>Partner Onboarding</Heading>
          </FocusModal.Title>
        </FocusModal.Header>

        <ProgressTabs value={currentStep} onValueChange={setCurrentStep}>
          <ProgressTabs.List className="border-b">
            <ProgressTabs.Trigger value="logo">Upload Logo</ProgressTabs.Trigger>
            <ProgressTabs.Trigger value="people">Add People</ProgressTabs.Trigger>
          </ProgressTabs.List>

          <FocusModal.Body className="overflow-auto">
            <ProgressTabs.Content value="logo" className="p-6">
              <div className="flex min-h-[300px] flex-col gap-y-4">
                <Text size="large" weight="plus">
                  Upload your company logo
                </Text>
                <div className="flex w-full flex-grow items-center justify-center">
                  <label className="bg-ui-bg-subtle hover:bg-ui-bg-base-pressed flex h-64 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed">
                    <div className="flex flex-col items-center justify-center pb-6 pt-5">
                      <Text size="small" className="text-ui-fg-subtle mb-2">
                        {logo ? logo.name : "Click to upload or drag and drop"}
                      </Text>
                      <Text size="small" className="text-ui-fg-muted">
                        SVG, PNG, JPG (MAX. 5MB)
                      </Text>
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

            <ProgressTabs.Content value="people" className="p-6">
              <div className="flex min-h-[300px] flex-col gap-y-4">
                <Text size="large" weight="plus">
                  Add your team members
                </Text>

                {error && <Alert variant="error">{error}</Alert>}
                {success && (
                  <Alert variant="success">Onboarding completed successfully!</Alert>
                )}

                <div className="flex-grow space-y-4">
                  {people.map((person, index) => (
                    <div
                      key={String(index)}
                      className="grid grid-cols-1 gap-4 rounded-lg border p-4 md:grid-cols-3"
                    >
                      <div>
                        <Text size="small" className="mb-1 block">
                          First Name
                        </Text>
                        <Input
                          value={person.first_name}
                          onChange={(e) =>
                            handlePersonChange(index, "first_name", e.target.value)
                          }
                          placeholder="John"
                        />
                      </div>
                      <div>
                        <Text size="small" className="mb-1 block">
                          Last Name
                        </Text>
                        <Input
                          value={person.last_name}
                          onChange={(e) =>
                            handlePersonChange(index, "last_name", e.target.value)
                          }
                          placeholder="Doe"
                        />
                      </div>
                      <div>
                        <Text size="small" className="mb-1 block">
                          Email
                        </Text>
                        <Input
                          value={person.email}
                          onChange={(e) =>
                            handlePersonChange(index, "email", e.target.value)
                          }
                          placeholder="john@company.com"
                          type="email"
                        />
                      </div>

                      {people.length > 1 && (
                        <div className="md:col-span-3 flex justify-end">
                          <Button
                            variant="danger"
                            size="small"
                            onClick={() => removePerson(index)}
                          >
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
          </FocusModal.Body>

          <FocusModal.Footer>
            <div className="flex items-center justify-end gap-x-2">
              <Button variant="secondary" onClick={handleSkip}>
                Skip
              </Button>
              {currentStep === "logo" ? (
                <Button onClick={() => setCurrentStep("people")}>Next</Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setCurrentStep("logo")}>
                    Back
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    isLoading={isSubmitting}
                    disabled={isSubmitting}
                  >
                    Complete Onboarding
                  </Button>
                </>
              )}
            </div>
          </FocusModal.Footer>
        </ProgressTabs>
      </FocusModal.Content>
    </FocusModal>
  )
}
