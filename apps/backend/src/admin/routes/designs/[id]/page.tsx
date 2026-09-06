import { LoaderFunctionArgs, UIMatch, useLoaderData, useParams } from "react-router-dom";
import { AdminDesignResponse, useDesign } from "../../../hooks/api/designs";
import { DesignGeneralSection } from "../../../components/designs/design-general-section";
import { DesignGraphSection } from "../../../components/designs/design-graph-section";
import { DesignDesignerInvitesSection } from "../../../components/designs/design-designer-invites-section";
import { DesignMediaSection } from "../../../components/designs/design-media-section";
import { DesignMediaFolderSection } from "../../../components/designs/design-media-folder-section";
import { DesignConsumptionLogsSection } from "../../../components/designs/design-consumption-logs-section";
import { DesignAttributesSection } from "../../../components/designs/design-attributes-section";
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
            EXPECTED AND MISSING. Sits at the top because every section below
            it renders what IS there, and an absent edge is the one thing none
            of them can show.

            🔴 STEP 6: production runs, inventory and bundled designs are GONE.
            Each came off only once the graph did its whole job, and the test
            was the same three questions each time — what does the card SHOW
            that the graph does not, what does it DO that the graph cannot, and
            what is it the only route to?

              - production runs — was kept purely to hold "create another run".
                The graph's `runs` node now offers "Start another run", and its
                href still reaches the full list.
              - inventory — the graph lists the items, unlinks them, and its
                rows now open `/designs/:id/inventory/:id`, the same drawer the
                card opened for planned quantity and stock location.
              - bundled designs — listed both directions, with removal on the
                inbound side (the outbound row belongs to the PARENT design and
                its endpoint would 404 from here).

            🔴 And the trap that made this safe: the canvas can only act on
            nodes it DRAWS, so a design with no components emits no `components`
            node and removing the card would have left NO route to adding the
            first one. The workspace's "Add" menu lists everything the spine can
            create whether or not a node for it is drawn. Step 3 stranded two
            sub-pages exactly this way.

            What stays, still for a reason and not by inertia:

              - consumption logs, construction — whole editors, not summaries.
              - media, media folder — deliberately unregistered in the graph: a
                design holds ONE folder and linking REPOINTS it, so "add" would
                silently replace what is already there.
              - designer invites — not on the graph at all yet.
          */}
          <DesignGraphSection design={design} />
          <DesignDesignerInvitesSection design={design} />
          <DesignConsumptionLogsSection design={design} />
        </TwoColumnPage.Main>
        <TwoColumnPage.Sidebar>
          <DesignAttributesSection design={design} />
          <DesignMediaFolderSection design={design} />
          <DesignMediaSection design={design} />
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