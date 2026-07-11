import { Badge, Container, Heading, Skeleton, Text } from "@medusajs/ui"
import { useMemo, useEffect } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { useMe } from "../../hooks/api/users"
import type { InvestorOnboarding } from "../onboarding/onboarding"

const TICKET_SIZE_LABELS: Record<string, string> = {
  under_25k: "Under $25k",
  "25k_100k": "$25k – $100k",
  "100k_500k": "$100k – $500k",
  "500k_1m": "$500k – $1M",
  over_1m: "$1M+",
}

const DashboardHome = ({ investor }: { investor: Record<string, any> }) => {
  const onboarding: InvestorOnboarding = investor?.metadata?.onboarding ?? {}

  return (
    <div className="flex w-full flex-col gap-y-4 px-4 py-6 md:px-6">
      <Container className="p-0">
        <div className="px-6 py-5">
          <Heading level="h1">Welcome, {investor?.name ?? "Investor"}</Heading>
          <Text className="text-ui-fg-subtle mt-1">
            Here's your investor overview.
          </Text>
        </div>
      </Container>

      <Container className="p-0">
        <div className="border-b px-6 py-4">
          <Heading level="h2">Your preferences</Heading>
        </div>
        <div className="flex flex-col gap-y-4 px-6 py-5">
          <div className="flex items-center gap-x-2">
            <Text weight="plus" className="w-40">
              Ticket size
            </Text>
            <Text className="text-ui-fg-subtle">
              {onboarding.ticket_size
                ? TICKET_SIZE_LABELS[onboarding.ticket_size] ??
                  onboarding.ticket_size
                : "—"}
            </Text>
          </div>
          <div className="flex items-start gap-x-2">
            <Text weight="plus" className="w-40 shrink-0">
              Interests
            </Text>
            <div className="flex flex-wrap gap-1.5">
              {onboarding.interests?.length ? (
                onboarding.interests.map((i) => <Badge key={i}>{i}</Badge>)
              ) : (
                <Text className="text-ui-fg-subtle">—</Text>
              )}
            </div>
          </div>
          <div className="flex items-center gap-x-2">
            <Text weight="plus" className="w-40">
              Quarterly letters
            </Text>
            <Badge color={onboarding.newsletter_quarterly ? "green" : "grey"}>
              {onboarding.newsletter_quarterly ? "Subscribed" : "Not subscribed"}
            </Badge>
          </div>
        </div>
      </Container>

      <Container className="p-0">
        <div className="px-6 py-8 text-center">
          <Text className="text-ui-fg-subtle">
            Your holdings, cap-table stakes and company updates will appear here
            as they're published.
          </Text>
        </div>
      </Container>
    </div>
  )
}

const HomeSkeleton = () => (
  <div className="flex w-full flex-col gap-y-4 px-4 py-6 md:px-6">
    <Skeleton className="h-24 w-full rounded-lg" />
    <Skeleton className="h-48 w-full rounded-lg" />
  </div>
)

export const Home = () => {
  const navigate = useNavigate()
  const { user, isPending } = useMe()

  const investor = (user ?? {}) as Record<string, any>
  const onboarding: InvestorOnboarding = investor?.metadata?.onboarding ?? {}

  const userId = (user as any)?.id
  const storageKey = useMemo(
    () => (userId ? `investor_onboarding_${userId}` : null),
    [userId]
  )

  const onboardingSkipped = useMemo(() => {
    if (!storageKey) return false
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw)?.skipped === true : false
    } catch {
      return false
    }
  }, [storageKey])

  const needsOnboarding =
    !isPending && !!user && !onboarding.completed && !onboardingSkipped

  // First-run: open the onboarding focus-modal over the dashboard.
  useEffect(() => {
    if (needsOnboarding) {
      navigate("/onboarding", { replace: true })
    }
  }, [needsOnboarding, navigate])

  if (isPending) {
    return <HomeSkeleton />
  }

  return (
    <>
      <DashboardHome investor={investor} />
      <Outlet />
    </>
  )
}
