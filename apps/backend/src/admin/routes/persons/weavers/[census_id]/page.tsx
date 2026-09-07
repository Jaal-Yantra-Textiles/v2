import { LoaderFunctionArgs, Link, UIMatch, useLoaderData, useParams } from "react-router-dom"
import { Button, Container, Heading, Text } from "@medusajs/ui"

import { useWeaver } from "../../../../hooks/api/census"
import { TwoColumnPage } from "../../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../../components/table/skeleton"
import { WeaverGeneralSection } from "../../../../components/persons/weaver-general-section"
import { WeaverCensusSection } from "../../../../components/persons/weaver-census-section"
import { WeaverRevealSection } from "../../../../components/persons/weaver-reveal-section"
import { weaverLoader } from "./loader"

const WeaverDetailPage = () => {
  const { census_id } = useParams()
  const initialData = useLoaderData() as Awaited<{ weaver: any }>

  const { data, isPending, isError, error } = useWeaver(census_id, { initialData })

  if (isPending || !data?.weaver) {
    return <TwoColumnPageSkeleton mainSections={2} sidebarSections={1} showJSON />
  }

  if (isError) {
    throw error
  }

  const weaver = data.weaver

  return (
    <TwoColumnPage data={weaver} hasOutlet showJSON>
      <TwoColumnPage.Main>
        <WeaverGeneralSection weaver={weaver} />
        <WeaverCensusSection weaver={weaver} />
        <Container className="flex items-center justify-between px-6 py-4">
          <div className="flex flex-col gap-y-1">
            <Heading level="h2">Edits &amp; changes</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Social media, corrections and custom fields for this record
            </Text>
          </div>
          <Button size="small" variant="secondary" asChild>
            <Link to="edits">Edit</Link>
          </Button>
        </Container>
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <WeaverRevealSection censusId={census_id!} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export async function loader({ params }: LoaderFunctionArgs) {
  return await weaverLoader({ params })
}

export const handle = {
  breadcrumb: (match: UIMatch<{ census_id: string }>) => `Weaver ${match.params.census_id}`,
}

export default WeaverDetailPage