import { Container, Heading, Text } from "@medusajs/ui"
import { getPartnerDesigns } from "../actions"
import DesignsTable, { PartnerDesignRow } from "./designs-table"


export const dynamic = "force-dynamic"

export default async function DesignsPage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  const sp = (await searchParams) || {}
  const page = Number(sp.page || 1)
  const limit = 20
  const offset = (page - 1) * limit

  const res = await getPartnerDesigns({ limit, offset })
  const designs = res?.designs || []
  const count = res?.count || 0

  return (
    <Container className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <Heading level="h2">All Designs</Heading>
        <Text size="small" className="text-ui-fg-subtle">{count} total</Text>
      </div>

      {designs.length === 0 ? (
        <div className="rounded-md border-ui-border-base p-8 text-center">
          <Text>No designs assigned yet.</Text>
        </div>
      ) : (
        <DesignsTable data={designs as PartnerDesignRow[]} count={count} />
      )}
    </Container>
  )
}
