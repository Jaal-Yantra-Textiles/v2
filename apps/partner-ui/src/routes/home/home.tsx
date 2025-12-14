import { Button, Checkbox, Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"

import { OnboardingModal } from "../../components/onboarding/onboarding-modal"
import { usePartnerAssignedTasks } from "../../hooks/api/partner-assigned-tasks"
import { usePartnerDesigns } from "../../hooks/api/partner-designs"
import { usePartnerInventoryOrders } from "../../hooks/api/partner-inventory-orders"
import { usePartnerStores } from "../../hooks/api/partner-stores"
import { useMe } from "../../hooks/api/users"

export const Home = () => {
  const { user } = useMe()
  const partner = user?.partner
  const partnerId = user?.partner_id

  const { stores, isPending: storesPending } = usePartnerStores()
  const store = stores?.[0]
  const hasStore = Boolean(store)

  const { tasks, count: tasksCount = 0 } = usePartnerAssignedTasks()
  const { inventory_orders, count: inventoryOrdersCount = 0 } =
    usePartnerInventoryOrders({ limit: 50, offset: 0 })
  const { designs, count: designsCount = 0 } = usePartnerDesigns({ limit: 50, offset: 0 })

  const tasksPending = useMemo(
    () => (tasks || []).filter((t) => String(t.status || "") === "pending").length,
    [tasks]
  )

  const inventoryOrdersPending = useMemo(
    () =>
      (inventory_orders || []).filter((o) => {
        const s = String(o?.status || "").toLowerCase()
        const ps = String(o?.partner_info?.partner_status || "").toLowerCase()
        return s === "pending" || s === "assigned" || s === "incoming" || ps === "incoming" || ps === "assigned"
      }).length,
    [inventory_orders]
  )

  const designsInProgress = useMemo(
    () =>
      (designs || []).filter((d) => {
        const ps = String(d?.partner_info?.partner_status || "").toLowerCase()
        return ps === "incoming" || ps === "assigned" || ps === "in_progress" || ps === "finished"
      }).length,
    [designs]
  )

  const storageKey = useMemo(() => {
    return partnerId ? `partner_onboarding_${partnerId}` : null
  }, [partnerId])

  const [onboardingOpen, setOnboardingOpen] = useState(false)

  const onboardingStatus = useMemo(() => {
    if (!partnerId || !storageKey) {
      return { completed: false, skipped: false }
    }

    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) {
        return { completed: false, skipped: false }
      }
      const parsed = JSON.parse(raw)
      return {
        completed: Boolean(parsed?.completed),
        skipped: Boolean(parsed?.skipped),
      }
    } catch {
      return { completed: false, skipped: false }
    }
  }, [partnerId, storageKey, onboardingOpen])

  useEffect(() => {
    if (!partnerId || !storageKey) {
      return
    }

    if (partner?.is_verified) {
      return
    }

    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) {
        setOnboardingOpen(true)
        return
      }

      const parsed = JSON.parse(raw)
      const completed = Boolean(parsed?.completed)
      const skipped = Boolean(parsed?.skipped)
      if (!completed && !skipped) {
        setOnboardingOpen(true)
      }
    } catch {
      setOnboardingOpen(true)
    }
  }, [partner?.is_verified, partnerId, storageKey])

  const verified = Boolean(partner?.is_verified)
  const onboardingDone = Boolean(onboardingStatus.completed || onboardingStatus.skipped)
  const partnerPending = !verified || String(partner?.status || "").toLowerCase() === "pending"

  const tasksTotal = tasksCount || tasks.length
  const invTotal = inventoryOrdersCount || inventory_orders.length
  const designsTotal = designsCount || designs.length

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        {!partnerPending ? (
          <div className="px-6 py-4">
            <Heading>Dashboard</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {store?.name
                ? `Store: ${store.name}`
                : partner?.name
                  ? `Partner: ${partner.name}`
                  : ""}
            </Text>
          </div>
        ) : null}

        <div className="px-6 py-4">
          <Heading level="h2">Getting started</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Complete these steps to start receiving and completing work.
          </Text>

          <div className="mt-4 divide-y rounded-lg border">
            <div className="flex items-start gap-3 p-4">
              <Checkbox checked={onboardingDone} disabled className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Text weight="plus">Complete onboarding</Text>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Add your details and team so we can activate your partner workspace.
                </Text>
              </div>
              {!onboardingDone && partnerId ? (
                <button
                  type="button"
                  className="text-ui-fg-interactive whitespace-nowrap"
                  onClick={() => setOnboardingOpen(true)}
                >
                  Open
                </button>
              ) : null}
            </div>

            <div className="flex items-start gap-3 p-4">
              <Checkbox checked={verified} disabled className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Text weight="plus">Get verified</Text>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Your account must be verified before you can fully operate.
                </Text>
              </div>
              {!verified ? (
                <Button size="small" variant="secondary" asChild>
                  <Link to="/verification">Upload</Link>
                </Button>
              ) : null}
            </div>

            <div className="flex items-start gap-3 p-4">
              <Checkbox checked={hasStore} disabled className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Text weight="plus">Create a store</Text>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Create your store to unlock publishing, inventory assignments, and sales channels.
                </Text>
              </div>
              {!storesPending && !hasStore ? (
                <Button size="small" variant="secondary" asChild disabled={!partnerId}>
                  <Link to="/create-store">Create</Link>
                </Button>
              ) : null}
            </div>

            <div className="flex items-start gap-3 p-4">
              <Checkbox checked={tasksPending === 0} disabled className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Text weight="plus">Review tasks</Text>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  {tasksTotal} total • {tasksPending} to accept
                </Text>
              </div>
              <Link to="/tasks" className="text-ui-fg-interactive whitespace-nowrap">
                View
              </Link>
            </div>

            <div className="flex items-start gap-3 p-4">
              <Checkbox checked={inventoryOrdersPending === 0} disabled className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Text weight="plus">Review inventory orders</Text>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  {invTotal} assigned • {inventoryOrdersPending} pending
                </Text>
              </div>
              <Link
                to="/inventory-orders"
                className="text-ui-fg-interactive whitespace-nowrap"
              >
                View
              </Link>
            </div>

            <div className="flex items-start gap-3 p-4">
              <Checkbox checked={designsInProgress === 0} disabled className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Text weight="plus">Review designs</Text>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  {designsTotal} assigned • {designsInProgress} in progress
                </Text>
              </div>
              <Link to="/designs" className="text-ui-fg-interactive whitespace-nowrap">
                View
              </Link>
            </div>

            <div className="flex items-start gap-3 p-4">
              <Checkbox checked={false} disabled className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Text weight="plus">Update profile (optional)</Text>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Keep your contact information up to date.
                </Text>
              </div>
              <Link
                to="/settings/profile"
                className="text-ui-fg-interactive whitespace-nowrap"
              >
                View
              </Link>
            </div>
          </div>
        </div>
      </Container>

      {partnerId ? (
        <OnboardingModal
          partnerId={partnerId}
          isOpen={onboardingOpen}
          onClose={() => setOnboardingOpen(false)}
        />
      ) : null}
    </div>
  )
}
