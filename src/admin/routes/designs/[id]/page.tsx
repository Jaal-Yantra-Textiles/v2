import { LoaderFunctionArgs, UIMatch, useLoaderData, useParams } from "react-router-dom";
import { AdminDesignResponse, useDesign } from "../../../hooks/api/designs";
import { DesignGeneralSection } from "../../../components/designs/design-general-section";
import { DesignPartnerSection } from "../../../components/designs/design-partner-section";
import { DesignTasksSection } from "../../../components/designs/design-tasks-section";
import { DesignMediaSection } from "../../../components/designs/design-media-section";
import { DesignMoodboardSidebarSection } from "../../../components/designs/design-moodboard-sidebar-section";
import { DesignInventorySection } from "../../../components/designs/design-inventory-section";
import { DesignSizesSection } from "../../../components/designs/design-sizes-section";
import { DesignTagsSection } from "../../../components/designs/design-tags-section";
import { DesignColorPaletteSection } from "../../../components/designs/design-color-palette-section";
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton";
import { TwoColumnPage } from "../../../components/pages/two-column-pages";
import { Toaster } from "@medusajs/ui";
import { designLoader } from "./loader";



const DesignDetailPage = () => {
  const { id } = useParams();

  const intialData = useLoaderData() as Awaited<AdminDesignResponse>
  
  // Use staleTime: 0 to ensure data is always refetched when navigating back to this page
  const { design, isLoading, isError, error } = useDesign(id!, {
    fields: [
      "inventory_items.*",
      "tasks.*",
      "tasks.subtasks.*",
      "tasks.outgoing.*",
      "tasks.incoming.*",
      "partners.*",
      "colors.*",
      "size_sets.*",
    ],
  }, {
    // This ensures fresh data is fetched when returning from other pages
    // This ensures the query is refetched when the component remounts
    initialData: intialData
  });

  // Show loading skeleton while data is being fetched
  if (isLoading || !design) {
    return <TwoColumnPageSkeleton mainSections={3} sidebarSections={4} showJSON showMetadata />;
  }

  // Handle error state
  if (isError) {
    throw error;
  }

  // Handle case where design is undefined but not loading
  if (!design) {
    throw new Error("Design not found");
  }
  
  return (
    <>
      <Toaster/>
      <TwoColumnPage 
        data={design}
        showJSON
        showMetadata
        hasOutlet={true}
      >
        <TwoColumnPage.Main>
          <DesignGeneralSection design={design} />
          <DesignSizesSection design={design} />
          <DesignTagsSection design={design} />
          <DesignColorPaletteSection design={design} />
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          <DesignMediaSection design={design} />
          <DesignMoodboardSidebarSection design={design} />
          <DesignTasksSection design={design} />
          <DesignInventorySection design={design} />
          <DesignPartnerSection design={design} />
        </TwoColumnPage.Sidebar>  
        </TwoColumnPage>
    </>
  );
};

export default DesignDetailPage;

export async function loader({ params }: LoaderFunctionArgs) {
  return designLoader({ params });
}


export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return `${id}`;
  },
};