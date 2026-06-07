import { Avatar, Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { Plus, TriangleRightMini } from "@medusajs/icons"
import { Link, useNavigate } from "react-router-dom"

import { AdminDesign } from "../../hooks/api/designs"

interface Props {
  design: AdminDesign
}

const PREVIEW_COUNT = 3

/**
 * Compact partners card for the design detail page (roadmap #8). Shows
 * the count + a few linked partners and links to the dedicated sub-page
 * (/designs/:id/partners) for the full list + management.
 */
export const DesignPartnerSummary = ({ design }: Props) => {
  const navigate = useNavigate()
  const partners = ((design as any)?.partners || []) as any[]
  const preview = partners.slice(0, PREVIEW_COUNT)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Partners</Heading>
          <Badge size="2xsmall" color="grey" rounded="full">
            {partners.length}
          </Badge>
        </div>
        <div className="flex items-center gap-x-2">
          <Button
            variant="secondary"
            size="small"
            onClick={() => navigate(`/designs/${design.id}/linkPartner`)}
          >
            <Plus className="mr-1" />
            Link Partner
          </Button>
          {partners.length > 0 && (
            <Button asChild variant="transparent" size="small">
              <Link to="partners">View all</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 py-3">
        {partners.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No partners linked to this design
            </Text>
          </div>
        ) : (
          <>
            {preview.map((partner: any) => (
              <Link
                key={partner.id}
                to="partners"
                className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
              >
                <div className="shadow-elevation-card-rest bg-ui-bg-component flex items-center gap-3 rounded-md px-4 py-2 transition-colors">
                  <Avatar
                    src={partner.logo || undefined}
                    fallback={partner.name?.charAt(0) || "P"}
                  />
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <Text size="small" leading="compact" weight="plus">
                      {partner.name || `Partner ${partner.id}`}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle truncate">
                      {partner.handle || "-"}
                    </Text>
                  </div>
                  <TriangleRightMini className="text-ui-fg-muted" />
                </div>
              </Link>
            ))}
            {partners.length > PREVIEW_COUNT && (
              <Link
                to="partners"
                className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover px-1 py-1"
              >
                <Text size="small" leading="compact">
                  View all {partners.length} partners →
                </Text>
              </Link>
            )}
          </>
        )}
      </div>
    </Container>
  )
}
