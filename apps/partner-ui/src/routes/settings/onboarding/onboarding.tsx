import { BuildingStorefront, PencilSquare } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text, clx } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"

import { SingleColumnPage } from "../../../components/layout/pages"
import { OnboardingModal } from "../../../components/onboarding/onboarding-modal"
import { useMe } from "../../../hooks/api/users"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

type UseType = "seller" | "manufacturer"

const USE_TYPE_OPTIONS: {
  value: UseType
  title: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: "seller",
    title: "Seller",
    description:
      "Sell products online. See Products, Orders, Customers, Categories, and Collections.",
    icon: <BuildingStorefront className="h-6 w-6" />,
  },
  {
    value: "manufacturer",
    title: "Manufacturer",
    description:
      "Design and manufacture textiles. See Designs, Inventory Orders, Production Runs, Tasks, and more.",
    icon: <PencilSquare className="h-6 w-6" />,
  },
]

export const SettingsOnboarding = () => {
  const { user } = useMe()
  const partnerId = user?.partner_id
  const currentUseType = (user?.partner?.metadata as any)?.use_type as UseType | undefined

  const [savingUseType, setSavingUseType] = useState(false)

  const handleUseTypeChange = async (useType: UseType) => {
    if (useType === currentUseType) return

    setSavingUseType(true)
    try {
      const existingMetadata = (user?.partner?.metadata as Record<string, any>) || {}
      await sdk.client.fetch("/partners/update", {
        method: "PUT",
        body: { metadata: { ...existingMetadata, use_type: useType } },
      })
      queryClient.invalidateQueries({ queryKey: ["users", "me"] })
    } catch (e) {
      console.error("Failed to update use type", e)
    } finally {
      setSavingUseType(false)
    }
  }

  const readStatus = useCallback(() => {
    if (!partnerId) {
      return { completed: false }
    }

    if (typeof window === "undefined") {
      return { completed: false }
    }

    try {
      const raw = localStorage.getItem(`partner_onboarding_${partnerId}`)
      if (!raw) {
        return { completed: false }
      }
      const parsed = JSON.parse(raw)
      return { completed: Boolean(parsed?.completed || parsed?.skipped) }
    } catch {
      return { completed: false }
    }
  }, [partnerId])

  const [status, setStatus] = useState(() => readStatus())
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setStatus(readStatus())
  }, [readStatus])

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading>Business Type</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Choose how you use JYT. This controls which navigation items appear
            in your sidebar.
          </Text>
        </div>

        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2">
          {USE_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={savingUseType}
              onClick={() => handleUseTypeChange(opt.value)}
              className={clx(
                "bg-ui-bg-base border rounded-lg p-4 text-left transition-all",
                "hover:shadow-elevation-card-hover",
                "focus-visible:shadow-borders-focus outline-none",
                currentUseType === opt.value
                  ? "border-ui-border-interactive shadow-elevation-card-rest"
                  : "border-ui-border-base"
              )}
            >
              <div className="flex items-center gap-x-3 mb-2">
                <div className="text-ui-fg-subtle">{opt.icon}</div>
                <Text size="small" weight="plus">
                  {opt.title}
                </Text>
                {currentUseType === opt.value && (
                  <Badge size="2xsmall" color="green">Active</Badge>
                )}
              </div>
              <Text className="text-ui-fg-subtle" size="small">
                {opt.description}
              </Text>
            </button>
          ))}
        </div>
      </Container>

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading>Onboarding</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Track onboarding completion and reopen the onboarding flow.
          </Text>
        </div>

        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Text size="small" weight="plus">
              Status
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              {status.completed ? "Completed" : "Not completed"}
            </Text>
          </div>

          <Button
            size="small"
            variant="secondary"
            onClick={() => setOpen(true)}
            disabled={!partnerId}
          >
            Open onboarding
          </Button>
        </div>
      </Container>

      {partnerId ? (
        <OnboardingModal
          partnerId={partnerId}
          isOpen={open}
          onClose={() => {
            setOpen(false)
            setStatus(readStatus())
          }}
        />
      ) : null}
    </SingleColumnPage>
  )
}
