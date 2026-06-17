import { Button, Heading, Text } from "@medusajs/ui"
import { ArrowUpRightOnBox, ArrowUturnLeft, ExclamationCircle } from "@medusajs/icons"
import { useLocation, useNavigate } from "react-router-dom"

/**
 * Catch-all rendered inside an EntityPanel when the tab's MemoryRouter
 * navigates to a path the panel doesn't register (e.g. a design links out
 * to an Order or Product, which live outside the Designs route subtree).
 *
 * Without this, an unmatched route renders nothing — the panel goes blank
 * and the only recovery is closing and reopening the tab. Here we keep the
 * tab alive and offer two ways out: step back inside the tab, or open the
 * page in the full admin (a normal browser tab outside the workspace).
 */
export const DeskRouteFallback = ({
  entityLabel,
}: {
  entityLabel: string
}) => {
  const location = useLocation()
  const navigate = useNavigate()

  const adminUrl = `${window.location.origin}/app${location.pathname}${location.search}`

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-y-3 text-center">
        <div className="text-ui-fg-muted">
          <ExclamationCircle />
        </div>
        <Heading level="h2">Not available in Desk</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          The {entityLabel} tab can&apos;t open{" "}
          <span className="font-mono text-ui-fg-base">{location.pathname}</span>{" "}
          inside the workspace. Go back, or open it in the full admin.
        </Text>
        <div className="mt-2 flex gap-x-2">
          <Button
            variant="secondary"
            size="small"
            onClick={() => navigate(-1)}
          >
            <ArrowUturnLeft />
            Go back
          </Button>
          <Button
            variant="primary"
            size="small"
            onClick={() => window.open(adminUrl, "_blank", "noopener,noreferrer")}
          >
            <ArrowUpRightOnBox />
            Open in full admin
          </Button>
        </div>
      </div>
    </div>
  )
}
