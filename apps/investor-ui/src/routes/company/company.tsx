import {
  Badge,
  Button,
  Container,
  Heading,
  Skeleton,
  Text,
} from "@medusajs/ui"
import { ArrowUpRightOnBox, DocumentText, Plus } from "@medusajs/icons"
import { Link, Outlet } from "react-router-dom"
import {
  useMyCompanies,
  useMyReferrals,
  type MyCompany,
  type Referral,
} from "../../hooks/api/companies"

const pct = (v?: number | null) =>
  v == null || Number(v) === 0 ? null : `${(Number(v) * 100).toFixed(2)}%`

const initials = (name?: string) =>
  (name || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()

const referralStatusColor = (
  s?: string
): "green" | "orange" | "red" | "grey" => {
  switch (s) {
    case "joined":
      return "green"
    case "contacted":
      return "orange"
    case "declined":
      return "red"
    default:
      return "grey"
  }
}

const LinkRow = ({ label, url }: { label: string; url: string }) => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    className="text-ui-fg-interactive flex items-center gap-x-1.5 text-sm hover:underline"
  >
    {label}
    <ArrowUpRightOnBox className="text-ui-fg-muted" />
  </a>
)

const CompanyCard = ({ company }: { company: MyCompany }) => {
  const p = company.profile || {}
  const hasLinks = (p.links?.length ?? 0) > 0 || p.github_url || p.pitch_deck_url
  return (
    <Container className="divide-y p-0">
      {/* Header */}
      <div className="flex items-start gap-x-4 px-6 py-5">
        {company.logo_url ? (
          <img
            src={company.logo_url}
            alt={company.name}
            className="size-12 rounded-lg object-cover"
          />
        ) : (
          <div className="bg-ui-bg-subtle text-ui-fg-subtle flex size-12 items-center justify-center rounded-lg text-sm font-medium">
            {initials(company.name)}
          </div>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-x-2">
            <Heading level="h2">{company.name}</Heading>
            {company.industry && (
              <Badge size="2xsmall" color="grey">
                {company.industry}
              </Badge>
            )}
          </div>
          {p.tagline && (
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {p.tagline}
            </Text>
          )}
          {company.website && (
            <div className="mt-2">
              <LinkRow label={company.website} url={company.website} />
            </div>
          )}
        </div>
      </div>

      {/* What the team is building */}
      {(company.description || (p.highlights?.length ?? 0) > 0) && (
        <div className="px-6 py-5">
          <Text weight="plus" className="mb-2">
            What we're building
          </Text>
          {company.description && (
            <Text size="small" className="text-ui-fg-subtle whitespace-pre-line">
              {company.description}
            </Text>
          )}
          {(p.highlights?.length ?? 0) > 0 && (
            <ul className="mt-3 flex flex-col gap-y-1.5">
              {p.highlights!.map((h, i) => (
                <li key={i} className="flex items-start gap-x-2 text-sm">
                  <span className="text-ui-fg-muted mt-1.5 block size-1 shrink-0 rounded-full bg-current" />
                  <span className="text-ui-fg-subtle">{h}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Links: github, pitch deck, custom */}
      {hasLinks && (
        <div className="flex flex-wrap items-center gap-4 px-6 py-4">
          {p.github_url && <LinkRow label="GitHub" url={p.github_url} />}
          {p.pitch_deck_url && (
            <a
              href={p.pitch_deck_url}
              target="_blank"
              rel="noreferrer"
              className="text-ui-fg-interactive flex items-center gap-x-1.5 text-sm hover:underline"
            >
              <DocumentText className="text-ui-fg-muted" />
              Pitch deck
            </a>
          )}
          {(p.links || []).map((l, i) =>
            l?.url ? (
              <LinkRow key={i} label={l.label || l.url} url={l.url} />
            ) : null
          )}
        </div>
      )}

      {/* Team — derived from the cap-table stakeholders */}
      <div className="px-6 py-5">
        <Text weight="plus" className="mb-1">
          Team &amp; investors
        </Text>
        <Text size="small" className="text-ui-fg-subtle mb-3">
          People already on the cap table.
        </Text>
        {company.team.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No one on the cap table yet.
          </Text>
        ) : (
          <div className="flex flex-col gap-y-2">
            {company.team.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
              >
                <div className="flex items-center gap-x-3">
                  <div className="bg-ui-bg-subtle text-ui-fg-subtle flex size-8 items-center justify-center rounded-full text-xs font-medium">
                    {initials(m.name)}
                  </div>
                  <Text size="small" weight="plus">
                    {m.name}
                    {m.is_me && (
                      <Badge size="2xsmall" color="blue" className="ml-2">
                        You
                      </Badge>
                    )}
                  </Text>
                </div>
                {pct(m.ownership_percentage) && (
                  <Text size="small" className="text-ui-fg-subtle">
                    {pct(m.ownership_percentage)}
                  </Text>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}

const SentInvites = ({ referrals }: { referrals: Referral[] }) => (
  <Container className="divide-y p-0">
    <div className="flex items-center justify-between px-6 py-4">
      <div>
        <Heading level="h2">Invites you've sent</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          People you've referred to the portal.
        </Text>
      </div>
      <Button size="small" variant="secondary" asChild>
        <Link to="invite">
          <Plus />
          Invite someone
        </Link>
      </Button>
    </div>
    {referrals.length === 0 ? (
      <div className="px-6 py-5">
        <Text size="small" className="text-ui-fg-subtle">
          You haven't invited anyone yet.
        </Text>
      </div>
    ) : (
      <div className="flex flex-col divide-y">
        {referrals.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between px-6 py-3"
          >
            <div>
              <Text size="small" weight="plus">
                {r.name}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {r.email}
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <Badge size="2xsmall" color="grey">
                {r.access_level === "view_only" ? "View-only" : "Investor"}
              </Badge>
              <Badge size="2xsmall" color={referralStatusColor(r.status)}>
                {r.status}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    )}
  </Container>
)

export const CompanyOverview = () => {
  const { companies = [], isPending } = useMyCompanies()
  const { referrals = [] } = useMyReferrals()

  return (
    <div className="flex flex-col gap-y-3">
      <div>
        <Heading level="h1">Company</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          What the teams you back are building — and who's involved.
        </Text>
      </div>

      {isPending ? (
        <Container className="p-6">
          <Skeleton className="h-48 w-full" />
        </Container>
      ) : companies.length === 0 ? (
        <Container className="p-6">
          <Text size="small" className="text-ui-fg-subtle">
            No company linked to your account yet.
          </Text>
        </Container>
      ) : (
        companies.map((c) => <CompanyCard key={c.id} company={c} />)
      )}

      <SentInvites referrals={referrals} />

      {/* Nested invite drawer route (/company/invite) */}
      <Outlet />
    </div>
  )
}
