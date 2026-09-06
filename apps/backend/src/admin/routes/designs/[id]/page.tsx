import { LoaderFunctionArgs, UIMatch, useLoaderData, useParams } from "react-router-dom";
import { AdminDesignResponse, useDesign } from "../../../hooks/api/designs";
import { DesignGeneralSection } from "../../../components/designs/design-general-section";
import { DesignGraphSection } from "../../../components/designs/design-graph-section";
import { DesignDesignerInvitesSection } from "../../../components/designs/design-designer-invites-section";
import { DesignMediaSection } from "../../../components/designs/design-media-section";
import { DesignMediaFolderSection } from "../../../components/designs/design-media-folder-section";
import { DesignInventorySection } from "../../../components/designs/design-inventory-section";
import { DesignConsumptionLogsSection } from "../../../components/designs/design-consumption-logs-section";
import { DesignAttributesSection } from "../../../components/designs/design-attributes-section";
import { DesignProductionRunsSummary } from "../../../components/designs/design-production-runs-summary";
import { DesignComponentsSection } from "../../../components/designs/design-components-section";
import { DesignConstructionSection } from "../../../components/designs/design-construction-section";
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
      "revised_from_id",
      "revision_number",
      "revision_notes",
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
          {/*
            #1847 — the spine and its neighbours, including the edges that are
            EXPECTED AND MISSING. Sits at the top because every section below it
            renders what IS there, and an absent edge is the one thing none of
            them can show.

            🔴 STEP 3: the Tasks and Partners summary cards are GONE. Both were
            a count, a preview and a link — all of which the graph now says
            better, and both of their actions (create a task, link a partner)
            open inside the workspace. What is still here stays for a reason,
            not by inertia:

              - production runs — the graph can send an unstarted design to
                production, but it has nowhere to create ANOTHER run beside the
                ones that exist. This card is the only route to that.
              - inventory, bundled designs — the graph adds; only these can
                REMOVE, and inventory's per-item drawer (planned quantity,
                stock location) has no representation on an aggregate node.
              - consumption logs, construction — whole editors, not summaries.
              - media — deliberately unregistered in the graph: a design holds
                one folder and linking repoints it, so "add" would silently
                replace.
              - designer invites — not on the graph at all.
          */}
          <DesignGraphSection design={design} />
          <DesignProductionRunsSummary design={design} />
          <DesignDesignerInvitesSection design={design} />
          <DesignInventorySection design={design} />
          <DesignConsumptionLogsSection design={design} />
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          <DesignAttributesSection design={design} />
          <DesignMediaFolderSection design={design} />
          <DesignMediaSection design={design} />
          <DesignComponentsSection design={design} />
          <DesignConstructionSection design={design} />
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