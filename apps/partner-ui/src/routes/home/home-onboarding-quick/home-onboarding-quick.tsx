import { useMemo, useState } from "react"
import {
  Alert,
  Button,
  Heading,
  Input,
  Text,
  clx,
  toast,
} from "@medusajs/ui"
import {
  BuildingStorefront,
  PencilSquare,
  Sparkles,
  Users,
} from "@medusajs/icons"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { RouteFocusModal, useRouteModal } from "../../../components/modals"
import { KeyboundForm } from "../../../components/utilities/keybound-form"
import { useMe } from "../../../hooks/api/users"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

/**
 * Minimal onboarding gate (#338/#958 — expressive, not linear).
 *
 * The ONLY blocking step for a new partner: their name + persona. Persona sets
 * `workspace_type` immediately so the correct (e.g. lean designer) sidebar loads
 * from the first screen. Everything else — logo, team, selling mode, plan — is
 * filled progressively later from the home checklist, nudged by email/
 * notifications. The full step-by-step wizard stays available at
 * `/onboarding/full` for partners who'd rather complete it all at once.
 */

type Persona = "seller" | "manufacturer" | "designer" | "individual"

const mapWorkspaceTypeToBusinessType = (workspaceType?: string): string => {
  if (workspaceType === "seller") return "seller"
  if (workspaceType === "individual") return "individual"
  if (workspaceType === "designer") return "designer"
  if (workspaceType === "manufacturer") return "manufacturer"
  return ""
}

const getOnboardingStorageKey = (partnerId: string) =>
  `partner_onboarding_${partnerId}`

export const HomeOnboardingQuick = () => {
  return (
    <RouteFocusModal>
      <QuickOnboardingForm />
    </RouteFocusModal>
  )
}

const QuickOnboardingForm = () => {
  const { t } = useTranslation()
  const { user } = useMe()
  const partner = user?.partner
  const partnerId = user?.partner_id
  const { handleSuccess } = useRouteModal()

  const metadata = (partner?.metadata || {}) as Record<string, any>
  const workspaceType = (partner as any)?.workspace_type as string | undefined

  const PERSONA_OPTIONS = useMemo<
    { value: Persona; title: string; description: string; icon: React.ReactNode }[]
  >(
    () => [
      {
        value: "seller",
        title: t("partner.onboardingSettings.businessType.seller.title"),
        description: t("partner.onboardingSettings.businessType.seller.description"),
        icon: <BuildingStorefront className="h-6 w-6" />,
      },
      {
        value: "manufacturer",
        title: t("partner.onboardingSettings.businessType.manufacturer.title"),
        description: t("partner.onboardingSettings.businessType.manufacturer.description"),
        icon: <PencilSquare className="h-6 w-6" />,
      },
      {
        value: "designer",
        title: t("partner.onboardingSettings.businessType.designer.title"),
        description: t("partner.onboardingSettings.businessType.designer.description"),
        icon: <Sparkles className="h-6 w-6" />,
      },
      {
        value: "individual",
        title: t("partner.onboardingSettings.businessType.individual.title"),
        description: t("partner.onboardingSettings.businessType.individual.description"),
        icon: <Users className="h-6 w-6" />,
      },
    ],
    [t]
  )

  const [businessName, setBusinessName] = useState<string>(
    () => metadata.business_name || partner?.name || ""
  )
  const [persona, setPersona] = useState<Persona | "">(() => {
    const mapped = mapWorkspaceTypeToBusinessType(workspaceType || metadata.use_type)
    return (mapped as Persona) || ""
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canContinue = businessName.trim().length > 0 && persona !== ""

  const handleSubmit = async () => {
    if (!canContinue) {
      setError(t("partner.quickOnboarding.errorMissing"))
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      // Persona → workspace_type (drives the sidebar), name + an essentials flag
      // so home stops routing the partner back here. The rest is progressive.
      await sdk.client.fetch("/partners/update", {
        method: "PUT",
        body: {
          workspace_type: persona,
          // Merge — the update workflow REPLACES the metadata column wholesale,
          // so spread existing keys to avoid clobbering country_code/use_type/etc.
          metadata: {
            ...metadata,
            business_name: businessName.trim(),
            onboarding_essentials_done: true,
          },
        },
      })
      queryClient.invalidateQueries({ queryKey: ["users", "me"] })

      // Record the persona in the onboarding profile too (non-blocking).
      try {
        await sdk.client.fetch("/partners/onboarding-profile", {
          method: "PUT",
          body: { person_type: personaToProfileType(persona) },
        })
      } catch {
        // profile is best-effort; the essentials flag above is the source of truth
      }

      if (partnerId) {
        try {
          localStorage.setItem(
            getOnboardingStorageKey(partnerId),
            JSON.stringify({
              completed: false,
              skipped: false,
              essentials_done: true,
              about: { business_name: businessName.trim() },
              essentials_at: new Date().toISOString(),
            })
          )
        } catch {
          // localStorage is a cache; the server flag is authoritative
        }
      }

      toast.success(t("partner.quickOnboarding.toastSaved"))
      handleSuccess("/")
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("partner.quickOnboarding.errorUnknown")
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <KeyboundForm
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
      className="flex h-full flex-col overflow-hidden"
    >
      <RouteFocusModal.Body className="overflow-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-6 px-6 py-10">
          <div>
            <Heading>{t("partner.quickOnboarding.heading")}</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {t("partner.quickOnboarding.description")}
            </Text>
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <div>
            <Text size="small" className="mb-1 block font-medium">
              {t("partner.quickOnboarding.nameLabel")}
            </Text>
            <Input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder={t("partner.quickOnboarding.namePlaceholder")}
              autoFocus
            />
          </div>

          <div>
            <Text size="small" className="mb-2 block font-medium">
              {t("partner.quickOnboarding.personaLabel")}
            </Text>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PERSONA_OPTIONS.map((opt) => {
                const selected = persona === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPersona(opt.value)}
                    className={clx(
                      "bg-ui-bg-base rounded-lg border p-4 text-left transition-all outline-none",
                      "hover:shadow-elevation-card-hover focus-visible:shadow-borders-focus",
                      selected
                        ? "border-ui-border-interactive shadow-elevation-card-rest"
                        : "border-ui-border-base"
                    )}
                  >
                    <div className="mb-2 flex items-center gap-x-3">
                      <div className="text-ui-fg-subtle">{opt.icon}</div>
                      <Text size="small" weight="plus">
                        {opt.title}
                      </Text>
                    </div>
                    <Text size="small" className="text-ui-fg-subtle">
                      {opt.description}
                    </Text>
                  </button>
                )
              })}
            </div>
          </div>

          <Text size="xsmall" className="text-ui-fg-muted">
            {t("partner.quickOnboarding.progressiveHint")}{" "}
            <Link
              to="/onboarding/full"
              className="text-ui-fg-interactive"
            >
              {t("partner.quickOnboarding.fullSetupLink")}
            </Link>
          </Text>
        </div>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <Button
            size="small"
            variant="primary"
            type="submit"
            isLoading={isSubmitting}
            disabled={!canContinue || isSubmitting}
          >
            {t("partner.quickOnboarding.continue")}
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </KeyboundForm>
  )
}

/** Map the persona (workspace_type) to the closest onboarding_profile person_type. */
function personaToProfileType(
  persona: Persona
): "individual" | "business" | "manufacturer" | "artisan" {
  switch (persona) {
    case "individual":
      return "individual"
    case "manufacturer":
      return "manufacturer"
    case "designer":
      return "artisan"
    case "seller":
    default:
      return "business"
  }
}
