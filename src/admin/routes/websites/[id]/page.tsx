import { UIMatch, useParams } from "react-router-dom";
import { useWebsite } from "../../../hooks/api/websites";
import { SingleColumnPageSkeleton } from "../../../components/table/skeleton";
import { SingleColumnPage } from "../../../components/pages/single-column-pages";
import { WebsiteGeneralSection } from "../../../components/websites/website-general-section";
import { WebsitePagesSection } from "../../../components/websites/website-pages-section";
import { WebsiteBlogSection } from "../../../components/websites/website-blog-section";

const WebsiteDetailPage = () => {
  const { id } = useParams();
  const { website, isLoading, isError, error } = useWebsite(id!);


  // Show loading skeleton while data is being fetched
  if (isLoading) {
    return <SingleColumnPageSkeleton sections={2} showJSON showMetadata />;
  }

  // Handle error state
  if (isError) {
    throw error;
  }

  // Handle case where website is undefined but not loading
  if (!website) {
    throw new Error("Website not found");
  }

  // Render main content when data is available
  return (
    <SingleColumnPage data={website} hasOutlet={true} showJSON showMetadata={true}>
      <WebsiteGeneralSection website={website} />
      <WebsitePagesSection website={website} />
      <WebsiteBlogSection website={website} />
    </SingleColumnPage>
  );
};

export default WebsiteDetailPage;


export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return `${id}`;
  },
};
