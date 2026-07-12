import {
  Badge,
  Container,
  Heading,
  Skeleton,
  Text,
} from "@medusajs/ui"
import { Buildings, CurrencyDollar, RocketLaunch, PencilSquare, DocumentText } from "@medusajs/icons"
import { useMemo, useEffect } from "react"
import { Outlet, useNavigate, Link } from "react-router-dom"
import { useMe } from "../../hooks/api/users"
import { useMyCapTable, useDeals, useMyConvertibles, isSafeDeal } from "../../hooks/api/investments"
import { useMyProjections } from "../../hooks/api/projections"
import { useIsViewOnly } from "../../hooks/api/companies"
import { SingleColumnPage } from "../../components/layout/pages"
import type { InvestorOnboarding } from "../onboarding/onboarding"

const TICKET_SIZE_LABELS: Record<string, string> = {
  under_25k: "Under $25k",
  "25k_100k": "$25k – $100k",
  "100k_500k": "$100k – $500k",
  "500k_1m": "$500k – $1M",
  over_1m: "$1M+",
}

const money = (v?: number | null, ccy?: string) =>
  v == null ? "—" : `${ccy ?? ""}${new Intl.NumberFormat().format(Number(v))}`

const num = (v?: number | null) =>
  v == null ? "—" : new Intl.NumberFormat().format(Number(v))

interface CompanySummary {
  id: string
  name: string
  totalInvested: number
  totalShares: number
  dealCount: number
}

const StatCard = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) => (
  <Container className="p-0">
    <div className="flex items-center gap-x-3 px-6 py-4">
      <div className="text-ui-fg-subtle">{icon}</div>
      <div>
        <Text size="small" className="text-ui-fg-subtle">{label}</Text>
        <Text weight="plus" className="mt-0.5">{value}</Text>
      </div>
    </div>
  </Container>
)

const CompanyRow = ({
  name,
  totalInvested,
  totalShares,
  dealCount,
  companyId,
}: CompanySummary & { companyId: string }) => (
  <Link
    to={`/companies/${companyId}`}
    className="flex items-center justify-between rounded-lg border px-4 py-3 transition-colors hover:bg-ui-bg-base-hover"
  >
    <div className="flex items-center gap-x-3">
      <Buildings className="text-ui-fg-muted" />
      <div>
        <Text weight="plus">{name}</Text>
        <Text size="small" className="text-ui-fg-subtle">
          {num(totalShares)} shares · {dealCount} deal{dealCount !== 1 ? "s" : ""}
        </Text>
      </div>
    </div>
    <Text weight="plus">{money(totalInvested)}</Text>
  </Link>
)

const DashboardHome = ({ investor }: { investor: Record<string, any> }) => {
  const navigate = useNavigate()
  const isViewOnly = useIsViewOnly()
  const onboarding: InvestorOnboarding = investor?.metadata?.onboarding ?? {}
  const onboardingCompleted = onboarding.completed === true

  const { capTables, isPending: ctPending } = useMyCapTable()
  const { deals, isPending: dealsPending } = useDeals()
  const { portfolio, isPending: posPending } = useMyProjections()
  const { summary: safeSummary, count: safeCount, isPending: safesPending } = useMyConvertibles()

  const companies = useMemo(() => {
    const seen = new Map<string, CompanySummary>()
    for (const ct of capTables) {
      const cid = ct.company_id ?? ct.id
      const existing = seen.get(cid)
      const totalInvested = ct.stakes?.reduce((s, st) => s + Number(st.total_invested ?? 0), 0) ?? 0
      const totalShares = ct.stakes?.reduce((s, st) => s + Number(st.number_of_shares ?? 0), 0) ?? 0
      if (existing) {
        seen.set(cid, {
          ...existing,
          totalInvested: existing.totalInvested + totalInvested,
          totalShares: existing.totalShares + totalShares,
        })
      } else {
        seen.set(cid, {
          id: cid,
          name: ct.name,
          totalInvested,
          totalShares,
          dealCount: 0,
        })
      }
    }
    for (const d of deals) {
      const cid = d.cap_table?.company_id
      if (cid && seen.has(cid)) {
        const existing = seen.get(cid)!
        seen.set(cid, { ...existing, dealCount: existing.dealCount + 1 })
      }
    }
    return Array.from(seen.values())
  }, [capTables, deals])

  const pending = ctPending || dealsPending || posPending || safesPending

  const openDeals = deals.filter((d) => d.status !== "closed" && d.status !== "cancelled")
  const totalInvested = portfolio?.total_invested ?? 0
  const hasSafes = safeCount > 0

  return (
    <>
      <Container className="p-0">
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <Heading level="h1">Welcome, {investor?.name ?? "Investor"}</Heading>
            <Text className="text-ui-fg-subtle mt-1">
              Here's your portfolio summary.
            </Text>
          </div>
          {onboardingCompleted && (
            <button
              type="button"
              onClick={() => navigate("/onboarding")}
              className="flex items-center gap-x-1.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover txt-compact-small-plus"
            >
              <PencilSquare className="h-4 w-4" />
              Edit preferences
            </button>
          )}
        </div>
      </Container>

      {pending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-3 ${hasSafes ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
          <StatCard icon={<CurrencyDollar />} label="Total invested" value={money(totalInvested)} />
          <StatCard icon={<Buildings />} label="Companies" value={num(companies.length)} />
          <StatCard icon={<RocketLaunch />} label="Open deals" value={num(openDeals.length)} />
          {hasSafes && (
            <Link to="/cap-table" className="block">
              <StatCard
                icon={<DocumentText />}
                label={`SAFEs (${safeCount})`}
                value={money(safeSummary.total_implied_value)}
              />
            </Link>
          )}
        </div>
      )}

      {!onboardingCompleted && (
        <Container className="p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading level="h2">Your preferences</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                Tell us your investment preferences to tailor your experience.
              </Text>
            </div>
            <button
              type="button"
              onClick={() => navigate("/onboarding")}
              className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
            >
              Set preferences
            </button>
          </div>
          <div className="flex flex-col gap-y-4 px-6 pb-4">
            <div className="flex items-center gap-x-2">
              <Text weight="plus" className="w-40">Ticket size</Text>
              <Text className="text-ui-fg-subtle">
                {onboarding.ticket_size
                  ? TICKET_SIZE_LABELS[onboarding.ticket_size] ?? onboarding.ticket_size
                  : "—"}
              </Text>
            </div>
            <div className="flex items-start gap-x-2">
              <Text weight="plus" className="w-40 shrink-0">Interests</Text>
              <div className="flex flex-wrap gap-1.5">
                {onboarding.interests?.length ? (
                  onboarding.interests.map((i) => <Badge key={i}>{i}</Badge>)
                ) : (
                  <Text className="text-ui-fg-subtle">—</Text>
                )}
              </div>
            </div>
          </div>
        </Container>
      )}

      {companies.length > 0 && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Your companies</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Companies you've invested in or are following.
            </Text>
          </div>
          <div className="flex flex-col gap-y-1 px-4 pb-4 pt-2">
            {companies.map((c) => (
              <CompanyRow key={c.id} {...c} companyId={c.id} />
            ))}
          </div>
        </Container>
      )}

      {openDeals.length > 0 && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Open deals</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {isViewOnly
                ? "Active funding rounds. Your account is view-only."
                : "Active funding rounds you can participate in."}
            </Text>
          </div>
          <div className="flex flex-col gap-y-1 px-4 pb-4 pt-2">
            {openDeals.map((d) => {
              const inner = (
                <>
                  <div>
                    <Text weight="plus" className="flex items-center gap-x-2">
                      {d.name}
                      {isSafeDeal(d) && <Badge size="2xsmall" color="purple">SAFE</Badge>}
                    </Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      {d.cap_table?.name ?? d.round_type ?? "Round"} · {money(d.target_amount)} target
                    </Text>
                  </div>
                  <Badge size="small" color="green">Open</Badge>
                </>
              )
              // View-only investors see the deals but can't open the
              // participate flow — render a static row, not a link.
              return isViewOnly ? (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  {inner}
                </div>
              ) : (
                <Link
                  key={d.id}
                  to={`/finances/participate/${d.id}`}
                  className="flex items-center justify-between rounded-lg border px-4 py-3 transition-colors hover:bg-ui-bg-base-hover"
                >
                  {inner}
                </Link>
              )
            })}
          </div>
        </Container>
      )}
    </>
  )
}

const HomeSkeleton = () => (
  <div className="flex flex-col gap-y-3">
    <Skeleton className="h-24 w-full rounded-lg" />
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-20 rounded-lg" />
    </div>
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

  useEffect(() => {
    if (needsOnboarding) {
      navigate("/onboarding", { replace: true })
    }
  }, [needsOnboarding, navigate])

  if (isPending) {
    return <HomeSkeleton />
  }

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <DashboardHome investor={investor} />
      <Outlet />
    </SingleColumnPage>
  )
}
