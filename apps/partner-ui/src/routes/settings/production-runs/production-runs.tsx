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
  const { partner, productionRunPolicy, isPending, isError } =
    usePartnerSettings()
  const { mutateAsync: updateSettings, isPending: isSaving } =
    useUpdatePartnerSettings()

  const enabled = !!partner?.auto_accept_production_runs

  // Both halves must be on (#1228). The platform's is off on production, so a
  // switch that only reported the partner's half was telling partners their
  // re-sent runs would be accepted when nothing would accept them. `null` is
  // "couldn't read it", which is not the same as "off" and mustn't be shown as
  // a definite answer either way.
  const platformAllows = productionRunPolicy?.auto_accept_on_retry ?? null
  const inEffect = enabled && platformAllows === true

  const handleToggle = async (next: boolean) => {
    try {
      await updateSettings({ auto_accept_production_runs: next })
      toast.success(
        next
          ? platformAllows === true
            ? "Re-sent production runs will be accepted for you"
            : "Saved — this will apply once the platform allows auto accept"
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

      {enabled && platformAllows === false && (
        <div className="px-6 py-4">
          <InlineTip variant="info" label="Not in effect yet">
            Your preference is saved, but auto accept is currently switched off
            for everyone on the platform, so every re-sent run still waits for
            you to accept it by hand. This setting will start working the moment
            that changes — you don't need to come back and turn it on again.
          </InlineTip>
        </div>
      )}

      {enabled && platformAllows === null && (
        <div className="px-6 py-4">
          <InlineTip variant="info" label="Saved">
            We couldn't check whether the platform currently allows auto accept,
            so we can't confirm this is taking effect. Your preference is saved
            either way.
          </InlineTip>
        </div>
      )}

      {inEffect && (
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
