import {
  Button,
  Heading,
  Select,
  Switch,
  Text,
  clx,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { RouteFocusModal } from "../../components/modals"
import { useMe, useUpdateMe } from "../../hooks/api/users"

export type InvestorOnboarding = {
  ticket_size?: string
  interests?: string[]
  newsletter_quarterly?: boolean
  completed?: boolean
  completed_at?: string
}

const TICKET_SIZES = [
  { value: "under_25k", label: "Under $25k" },
  { value: "25k_100k", label: "$25k – $100k" },
  { value: "100k_500k", label: "$100k – $500k" },
  { value: "500k_1m", label: "$500k – $1M" },
  { value: "over_1m", label: "$1M+" },
]

const INTERESTS = [
  "Textiles & Manufacturing",
  "Handloom & Artisan",
  "Sustainability",
  "Consumer Brands",
  "Supply Chain",
  "Technology",
  "Early Stage",
  "Growth Stage",
]

const OnboardingInner = ({
  metadata,
}: {
  metadata?: Record<string, any> | null
}) => {
  const navigate = useNavigate()
  const existing: InvestorOnboarding = metadata?.onboarding ?? {}

  const [ticketSize, setTicketSize] = useState<string>(existing.ticket_size ?? "")
  const [interests, setInterests] = useState<string[]>(existing.interests ?? [])
  const [newsletter, setNewsletter] = useState<boolean>(
    existing.newsletter_quarterly ?? true
  )

  const { mutateAsync, isPending } = useUpdateMe({
    onSuccess: () => {
      toast.success("Welcome aboard — your preferences are saved.")
      navigate("/", { replace: true })
    },
    onError: (err: any) => {
      toast.error(err?.message || "Could not save your preferences")
    },
  })

  const toggleInterest = (interest: string) => {
    setInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest]
    )
  }

  const canSubmit = ticketSize !== "" && interests.length > 0 && !isPending

  const handleSubmit = async () => {
    if (!canSubmit) {
      toast.error("Pick a ticket size and at least one interest to continue.")
      return
    }
    await mutateAsync({
      // Merge so we never drop other metadata keys the backend may set.
      metadata: {
        ...(metadata ?? {}),
        onboarding: {
          ticket_size: ticketSize,
          interests,
          newsletter_quarterly: newsletter,
          completed: true,
          completed_at: new Date().toISOString(),
        } satisfies InvestorOnboarding,
      },
    })
  }

  return (
    <>
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-10">
        <div className="flex w-full max-w-xl flex-col gap-y-8">
          <div className="flex flex-col gap-y-2">
            <Heading level="h1">Welcome to your investor portal</Heading>
            <Text className="text-ui-fg-subtle">
              A few quick questions so we can tailor what you see and hear from us.
            </Text>
          </div>

          {/* Ticket size */}
          <div className="flex flex-col gap-y-3 rounded-lg border bg-ui-bg-base p-5">
            <div className="flex flex-col gap-y-1">
              <Text weight="plus">Typical ticket size</Text>
              <Text size="small" className="text-ui-fg-subtle">
                How much do you usually invest per opportunity?
              </Text>
            </div>
            <Select value={ticketSize} onValueChange={setTicketSize}>
              <Select.Trigger>
                <Select.Value placeholder="Select a range" />
              </Select.Trigger>
              <Select.Content>
                {TICKET_SIZES.map((t) => (
                  <Select.Item key={t.value} value={t.value}>
                    {t.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          {/* Interests */}
          <div className="flex flex-col gap-y-3 rounded-lg border bg-ui-bg-base p-5">
            <div className="flex flex-col gap-y-1">
              <Text weight="plus">Interests</Text>
              <Text size="small" className="text-ui-fg-subtle">
                Pick the areas you'd like to hear about (choose one or more).
              </Text>
            </div>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((interest) => {
                const active = interests.includes(interest)
                return (
                  <button
                    key={interest}
                    type="button"
                    onClick={() => toggleInterest(interest)}
                    className={clx(
                      "txt-compact-small rounded-full border px-3 py-1.5 transition-colors",
                      active
                        ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                        : "border-ui-border-base bg-ui-bg-base text-ui-fg-subtle hover:bg-ui-bg-base-hover"
                    )}
                  >
                    {interest}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Newsletter */}
          <div className="flex items-center justify-between rounded-lg border bg-ui-bg-base p-5">
            <div className="flex flex-col gap-y-1 pr-4">
              <Text weight="plus">Quarterly investor letters</Text>
              <Text size="small" className="text-ui-fg-subtle">
                Receive our portfolio & company update email every quarter.
              </Text>
            </div>
            <Switch checked={newsletter} onCheckedChange={setNewsletter} />
          </div>

          <div className="flex items-center justify-end gap-x-3">
            <Button
              variant="primary"
              onClick={handleSubmit}
              isLoading={isPending}
              disabled={!canSubmit}
            >
              Finish setup
            </Button>
          </div>
        </div>
      </RouteFocusModal.Body>
    </>
  )
}

export const Onboarding = () => {
  const { user, isPending } = useMe()
  const metadata = (user as any)?.metadata ?? null

  return (
    <RouteFocusModal prev="/">
      {!isPending && <OnboardingInner metadata={metadata} />}
    </RouteFocusModal>
  )
}
