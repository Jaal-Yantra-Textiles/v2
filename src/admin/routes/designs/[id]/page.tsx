import { useParams } from "react-router-dom";
import { useDesign } from "../../../hooks/api/designs";
import { DesignGeneralSection } from "../../../components/designs/design-general-section";
import { DesignTasksSection } from "../../../components/designs/design-tasks-section";
import { DesignMediaSection } from "../../../components/designs/design-media-section";
import { DesignInventorySection } from "../../../components/designs/design-inventory-section";
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton";
import { TwoColumnPage } from "../../../components/pages/two-column-pages";


const DesignDetailPage = () => {
  const { id } = useParams();
  const { design, isLoading, isError, error } = useDesign(id!, {
    fields: ["+inventory_items.*", 'tasks.*']
  });

  // Show loading skeleton while data is being fetched
  if (isLoading) {
    return <TwoColumnPageSkeleton mainSections={2} showJSON showMetadata />;
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
      >
        <TwoColumnPage.Main>
          <DesignGeneralSection design={design} />
         
          <DesignMediaSection design={design} />
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          <DesignInventorySection design={design} />
          <DesignTasksSection design={design} />
        </TwoColumnPage.Sidebar>
        </TwoColumnPage>
  );
};

export default DesignDetailPage;
