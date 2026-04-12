import { BuildingStorefront, PencilSquare, Users } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text, clx } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import { useMe } from "../../../hooks/api/users"
import { sdk } from "../../../lib/client"
import { queryClient } from "../../../lib/query-client"

type WorkspaceType = "seller" | "manufacturer" | "individual"

const WORKSPACE_TYPE_OPTIONS: {
  value: WorkspaceType
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
  {
    value: "individual",
    title: "Individual",
    description:
      "Work on assigned tasks. See Tasks, Shared Folders, and Payment Submissions.",
    icon: <Users className="h-6 w-6" />,
  },
]

export const SettingsOnboarding = () => {
  const { user } = useMe()
  const partnerId = user?.partner_id
  const currentWorkspaceType = (
    (user?.partner as any)?.workspace_type ||
    (user?.partner?.metadata as any)?.use_type
  ) as WorkspaceType | undefined

  const [savingWorkspaceType, setSavingWorkspaceType] = useState(false)

  const handleWorkspaceTypeChange = async (workspaceType: WorkspaceType) => {
    if (workspaceType === currentWorkspaceType) return

    setSavingWorkspaceType(true)
    try {
      await sdk.client.fetch("/partners/update", {
        method: "PUT",
        body: { workspace_type: workspaceType },
      })
      queryClient.invalidateQueries({ queryKey: ["users", "me"] })
    } catch (e) {
      console.error("Failed to update workspace type", e)
    } finally {
      setSavingWorkspaceType(false)
    }
  }

  const readStatus = useCallback(() => {
    if (!partnerId || typeof window === "undefined") return { completed: false }
    try {
      const raw = localStorage.getItem(`partner_onboarding_${partnerId}`)
      if (!raw) return { completed: false }
      const parsed = JSON.parse(raw)
      return { completed: Boolean(parsed?.completed || parsed?.skipped) }
    } catch {
      return { completed: false }
    }
  }, [partnerId])

  const [status, setStatus] = useState(() => readStatus())

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

        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-3">
          {WORKSPACE_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={savingWorkspaceType}
              onClick={() => handleWorkspaceTypeChange(opt.value)}
              className={clx(
                "bg-ui-bg-base border rounded-lg p-4 text-left transition-all",
                "hover:shadow-elevation-card-hover",
                "focus-visible:shadow-borders-focus outline-none",
                currentWorkspaceType === opt.value
                  ? "border-ui-border-interactive shadow-elevation-card-rest"
                  : "border-ui-border-base"
              )}
            >
              <div className="flex items-center gap-x-3 mb-2">
                <div className="text-ui-fg-subtle">{opt.icon}</div>
                <Text size="small" weight="plus">
                  {opt.title}
                </Text>
                {currentWorkspaceType === opt.value && (
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

          <Button size="small" variant="secondary" asChild disabled={!partnerId}>
            <Link to="/onboarding">Open onboarding</Link>
          </Button>
        </div>
      </Container>
    </SingleColumnPage>
  )
}
