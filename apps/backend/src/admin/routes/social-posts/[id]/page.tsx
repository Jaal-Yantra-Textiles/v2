import { UIMatch, useParams, useLoaderData } from "react-router-dom"
import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import { useSocialPost } from "../../../hooks/api/social-posts"
import { SocialPostGeneralSection } from "../../../components/social-posts/social-post-general-section"
import { SocialPostInsightsSection } from "../../../components/social-posts/social-post-insights-section"
import { socialPostLoader } from "./loader"

const SocialPostDetailPage = () => {
  const { id } = useParams()
  const initialData = useLoaderData() as Awaited<ReturnType<typeof socialPostLoader>>
  
  const { socialPost: post, isLoading, isError, error } = useSocialPost(id!, undefined, {
    initialData
  })

  if (isLoading || !post) {
    return <TwoColumnPageSkeleton mainSections={1} sidebarSections={1} showJSON showMetadata />
  }

  if (isError) {
    throw error
  }

  return (
    <TwoColumnPage data={post} showJSON showMetadata hasOutlet={true}>
      <TwoColumnPage.Main>
        <SocialPostGeneralSection post={post} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <SocialPostInsightsSection post={post} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export default SocialPostDetailPage

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params
    return id || "Detail"
  },
}

export const loader = socialPostLoader
