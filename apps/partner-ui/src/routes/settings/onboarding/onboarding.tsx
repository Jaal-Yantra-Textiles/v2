import { Button, Container, Heading, Text } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"

import { SingleColumnPage } from "../../../components/layout/pages"
import { OnboardingModal } from "../../../components/onboarding/onboarding-modal"
import { useMe } from "../../../hooks/api/users"

export const SettingsOnboarding = () => {
  const { user } = useMe()
  const partnerId = user?.partner_id

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
