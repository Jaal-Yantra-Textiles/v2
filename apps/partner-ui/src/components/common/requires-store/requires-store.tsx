import { BuildingStorefront } from "@medusajs/icons"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { usePartnerStores } from "../../../hooks/api/partner-stores"
import { Skeleton } from "../skeleton"

/**
 * Wraps children that require a partner store to exist.
 * Shows a prompt to create a store if none exists,
 * instead of loading infinitely.
 */
export const RequiresStore = ({ children }: { children: React.ReactNode }) => {
  const { stores, isPending } = usePartnerStores()

  if (isPending) {
    return (
      <Container className="p-6">
        <div className="flex flex-col gap-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="mt-4 h-32 w-full" />
        </div>
      </Container>
    )
  }

  const store = stores?.[0]

  if (!store) {
    return (
      <Container className="flex flex-col items-center justify-center gap-y-4 py-16">
        <div className="bg-ui-bg-base flex h-14 w-14 items-center justify-center rounded-lg border shadow-sm">
          <BuildingStorefront className="text-ui-fg-subtle h-7 w-7" />
        </div>
        <div className="text-center">
          <Heading level="h2">No store created</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Create a store first to manage regions, sales channels, locations,
            and tax settings.
          </Text>
        </div>
        <Button variant="secondary" size="small" asChild>
          <Link to="/create-store">Create Store</Link>
        </Button>
      </Container>
    )
  }

  return <>{children}</>
}
