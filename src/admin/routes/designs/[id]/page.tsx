import { useParams } from "react-router-dom";
import { TwoColumnLayout } from "../../../components/two-side-column";
import { useDesign } from "../../../hooks/api/designs";
import { DesignGeneralSection } from "../../../components/designs/design-general-section";
import { DesignTasksSection } from "../../../components/designs/design-tasks-section";
import { DesignMediaSection } from "../../../components/designs/design-media-section";
import { DesignInventorySection } from "../../../components/designs/design-inventory-section";
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton";


const DesignDetailPage = () => {
  const { id } = useParams();
  const { design, isLoading, isError, error } = useDesign(id!);

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
      <TwoColumnLayout 
        firstCol={
          <div className="flex flex-col gap-y-4">
            <DesignGeneralSection design={design} />
            <DesignMediaSection design={design} />
            <DesignInventorySection design={design} />
          </div>
        }
        secondCol={
          <div className="flex flex-col gap-y-4">
            <DesignTasksSection design={design} />
          </div>
        }
      />
  );
};

export default DesignDetailPage;
