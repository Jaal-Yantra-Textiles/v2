import { UIMatch, useParams } from "react-router-dom";
import { usePage } from "../../../../../hooks/api/pages";
import { TwoColumnPageSkeleton } from "../../../../../components/table/skeleton";
import { TwoColumnPage } from "../../../../../components/pages/two-column-pages";
import { PageGeneralSection } from "../../../../../components/websites/page-general-section";
import { WebsiteBlocksSection } from "../../../../../components/websites/website-blocks-section";



const PageDetailPage = () => {
  const { id, pageId } = useParams();
  const { page, isLoading, isError, error } = usePage(id!, pageId!);

  // Show loading skeleton while data is being fetched
  if (isLoading) {
    return <TwoColumnPageSkeleton mainSections={2} showJSON showMetadata />;
  }

  // Handle error state
  if (isError) {
    throw error;
  }

  // Handle case where design is undefined but not loading
  if (!page) {
    throw new Error("Design not found");
  }

  return (
      <TwoColumnPage 
        data={page}
        showJSON
        showMetadata
      >
        <TwoColumnPage.Main>
          <PageGeneralSection page={page} websiteId={id!}/>
          <WebsiteBlocksSection websiteId={id!} pageId={page.id}/>
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          
        </TwoColumnPage.Sidebar>
        </TwoColumnPage>
  );
};

export default PageDetailPage;

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { pageId } = match.params;
    return `page_${pageId}`;
  },
};
