import { Container, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import { TwoColumnPageSkeleton } from "../../../../components/table/skeleton"
import { useQuoteDraft } from "../../../../hooks/api/quotes"
import { DraftSections } from "./draft-sections"

/**
 * A draft quote's page (#1446).
 *
 * The row already exists — the create modal made it — so this is a DETAIL
 * route, not a create one, exactly as a draft order's page is. Each section
 * saves into the row it is looking at.
 */
const QuoteDraftPage = () => {
  const { id } = useParams()
  const { data, isLoading, isError } = useQuoteDraft(id!)

  if (isLoading) {
    return <TwoColumnPageSkeleton mainSections={4} sidebarSections={1} />
  }

  if (isError || !data?.draft) {
    return (
      <Container>
        <Text size="small" className="text-ui-fg-subtle">
          This draft could not be loaded. It may have been minted already — a
          minted quote lives under Quotes, and its prices are frozen.
        </Text>
      </Container>
    )
  }

  return (
    <div className="flex w-full flex-col gap-y-3 p-3">
      <DraftSections draft={data.draft} />
    </div>
  )
}

export const handle = {
  breadcrumb: () => "Draft",
}

export default QuoteDraftPage
