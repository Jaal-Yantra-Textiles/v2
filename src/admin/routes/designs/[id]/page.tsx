import { UIMatch, useParams } from "react-router-dom";
import { useDesign } from "../../../hooks/api/designs";
import { DesignGeneralSection } from "../../../components/designs/design-general-section";
import { DesignTasksSection } from "../../../components/designs/design-tasks-section";
import { DesignMediaSection } from "../../../components/designs/design-media-section";
import { DesignInventorySection } from "../../../components/designs/design-inventory-section";
import { DesignSizesSection } from "../../../components/designs/design-sizes-section";
import { DesignTagsSection } from "../../../components/designs/design-tags-section";
import { DesignColorPaletteSection } from "../../../components/designs/design-color-palette-section";
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton";
import { TwoColumnPage } from "../../../components/pages/two-column-pages";



const DesignDetailPage = () => {
  const { id } = useParams();
  
  // Use staleTime: 0 to ensure data is always refetched when navigating back to this page
  const { design, isLoading, isError, error } = useDesign(id!, {
    fields: ["+inventory_items.*", '+tasks.*', 'tasks.subtasks.*', 'tasks.outgoing.*', 'tasks.incoming.*']
  }, {
    // This ensures fresh data is fetched when returning from other pages
    staleTime: 0,
    // This ensures the query is refetched when the component remounts
    refetchOnMount: true
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
      <TwoColumnPage 
        data={design}
        showJSON
        showMetadata
        hasOutlet={true}
      >
        <TwoColumnPage.Main>
          <DesignGeneralSection design={design} />
          <DesignMediaSection design={design} />
          <DesignSizesSection design={design} />
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          <DesignTasksSection design={design} />
          <DesignInventorySection design={design} />
          <DesignTagsSection design={design} />
          <DesignColorPaletteSection design={design} />
        </TwoColumnPage.Sidebar>  
        </TwoColumnPage>
  );
};

export default DesignDetailPage;


export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return `${id}`;
  },
};