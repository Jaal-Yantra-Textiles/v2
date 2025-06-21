import { UIMatch, useParams } from "react-router-dom"
import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import { useSocialPost } from "../../../hooks/api/social-posts"
import { SocialPostGeneralSection } from "../../../components/social-posts/social-post-general-section"

const SocialPostDetailPage = () => {
  const { id } = useParams()
  const { socialPost: post, isLoading, isError, error } = useSocialPost(id!)

  if (isLoading || !post) {
    return <TwoColumnPageSkeleton mainSections={2} sidebarSections={0} showJSON showMetadata />
  }

  if (isError) {
    throw error
  }

  return (
    <TwoColumnPage data={post} showJSON showMetadata hasOutlet={true}>
      <TwoColumnPage.Main>
        <SocialPostGeneralSection post={post} />
        {/* Additional main sections placeholder */}
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        {/* Sidebar sections placeholder */}
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
