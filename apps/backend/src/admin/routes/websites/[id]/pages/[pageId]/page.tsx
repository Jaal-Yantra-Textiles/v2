import { UIMatch, useParams } from "react-router-dom";
import { usePage } from "../../../../../hooks/api/pages";
import { TwoColumnPageSkeleton } from "../../../../../components/table/skeleton";
import { TwoColumnPage } from "../../../../../components/pages/two-column-pages";
import { PageGeneralSection } from "../../../../../components/websites/page-general-section";
import { WebsiteBlocksSection } from "../../../../../components/websites/website-blocks-section";
import { PageAuthorSection } from "../../../../../components/websites/page-author-section";
import { BlogSubscriptionInfo } from "../../../../../components/blogs/blog-subscription-info";



const PageDetailPage = () => {
  const { id, pageId } = useParams();
  const { page, isLoading, isError, error } = usePage(id!, pageId!);

  // Show loading skeleton while data is being fetched
  if (isLoading && !page) {
    return <TwoColumnPageSkeleton mainSections={2} sidebarSections={2} showJSON showMetadata />;
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
        showPublicMetadata
      >
        <TwoColumnPage.Main>
          <PageGeneralSection page={page} websiteId={id!}/>
          <WebsiteBlocksSection websiteId={id!} pageId={page.id}/>
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          {page.page_type === "Blog" && (
            <div className="flex flex-col gap-y-2">
              <PageAuthorSection page={page} websiteId={id!} />
              <BlogSubscriptionInfo page={page} websiteId={id!} />
            </div>
          )}
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
