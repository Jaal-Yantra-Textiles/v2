import { LoaderFunctionArgs, UIMatch, useLoaderData, useParams } from "react-router-dom"

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
    <TwoColumnPage data={weaver} hasOutlet={false} showJSON>
      <TwoColumnPage.Main>
        <WeaverGeneralSection weaver={weaver} />
        <WeaverCensusSection weaver={weaver} />
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