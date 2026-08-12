import {
  Container,
  Heading,
  InlineTip,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"

import { SingleColumnPage } from "../../../components/layout/pages"
import { GeneralSectionSkeleton } from "../../../components/common/skeleton"
import {
  usePartnerSettings,
  useUpdatePartnerSettings,
} from "../../../hooks/api/partner-settings"

/**
 * Settings › Production Runs — the partner's own policy for the work sent to
 * them.
 *
 * Today that's one switch, and it exists because the platform side of it
 * already shipped with no way to opt in: `partner.auto_accept_production_runs`
 * is a real column (#1228) that `emit-production-run-reminder` reads, but
 * nothing in either UI could ever set it, so it was false for every partner and
 * the auto-accept path was dead code.
 */
const AutoAcceptSection = () => {
  const { partner, isPending, isError } = usePartnerSettings()
  const { mutateAsync: updateSettings, isPending: isSaving } =
    useUpdatePartnerSettings()

  const enabled = !!partner?.auto_accept_production_runs

  const handleToggle = async (next: boolean) => {
    try {
      await updateSettings({ auto_accept_production_runs: next })
      toast.success(
        next
          ? "Re-sent production runs will be accepted for you"
          : "Re-sent production runs will wait for you to accept"
      )
    } catch (e: any) {
      toast.error("Could not save", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  if (isPending) {
    return <GeneralSectionSkeleton rowCount={2} />
  }

  if (isError || !partner) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Auto accept</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Could not load your production settings.
          </Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Auto accept</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          What happens when work you didn't accept is sent to you again
        </Text>
      </div>

      <div className="flex items-start justify-between gap-x-6 px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Text size="small" weight="plus">
            Accept re-sent runs for me
          </Text>
          <Text size="small" className="text-ui-fg-subtle">
            If a design run is dispatched to you and you don't accept it in
            time, it gets re-sent. With this on, that second dispatch is
            accepted on your behalf so production can start without another
            round trip. Your FIRST dispatch is never auto-accepted — you always
            get the chance to look at new work before taking it on.
          </Text>
        </div>
        <Switch
          checked={enabled}
          disabled={isSaving}
          onCheckedChange={handleToggle}
          aria-label="Accept re-sent production runs automatically"
        />
      </div>

      {enabled && (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label="You own the work">
            An auto-accepted run is yours — the same deadlines, reminders and
            completion steps apply as if you had accepted it by hand. Turn this
            off if you'd rather see every run before it becomes your
            responsibility.
          </InlineTip>
        </div>
      )}
    </Container>
  )
}

export const SettingsProductionRuns = () => {
  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet>
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading>Production Runs</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            How design orders are handed to you
          </Text>
        </div>
      </Container>

      <AutoAcceptSection />
    </SingleColumnPage>
  )
}

export const Component = SettingsProductionRuns
