import { Container, Heading, Text } from "@medusajs/ui";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { PencilSquare } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";
import { AdminWebsite, useWebsites } from "../../hooks/api/websites";
import { CardTable } from "../../components/table/card-table";
import { useWebsitesTableQuery } from "../../hooks/useWebsitesTableQuery";
import { useWebsitesTableFilters } from "../../hooks/filters/useWebsitesTableFilters";
import { useWebsiteCardKeys } from "../../hooks/cards/useWebsiteCardKeys";
import { WebsiteCard } from "../../components/websites/website-card";


const WebsitesPage = () => {
  const { searchParams: queryParams, raw } = useWebsitesTableQuery({
    pageSize: 2 
  });
  
  const { websites, isLoading, count } = useWebsites(
    queryParams,
    {
      placeholderData: keepPreviousData,
    }
  );

  const filters = useWebsitesTableFilters();
  const cardKeys = useWebsiteCardKeys();

  const websiteActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (website: AdminWebsite) => `/app/websites/${website.id}/edit`,
      },
    ],
  };

  const renderWebsiteCard = (website: AdminWebsite) => (
    <WebsiteCard
      website={website}
      cardKeys={cardKeys}
      actionsConfig={websiteActionsConfig}
    />
  );

  const navigateToWebsite = (website: AdminWebsite) => `/websites/${website.id}`;


  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Websites</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage all your websites from here
          </Text>
        </div>
        <CreateButton />
      </div>
      <CardTable
        data={websites ?? []}
        count={count || 0}
        pageIndex={Math.floor((queryParams.offset || 0) / 2)}
        pageSize={2}
        filters={filters}
        isLoading={isLoading}
        search={true}
        renderCard={renderWebsiteCard}
        noRecords={{
          title: "No websites found",
          message: "Try adjusting your search or filter settings.",
        }}
        queryObject={raw}
        navigateTo={navigateToWebsite}
      />
    </Container>
  );
};

export default WebsitesPage;

export const config = defineRouteConfig({
  label: "Websites",
  icon: PencilSquare,
});

export const handle = {
  breadcrumb: () => "Websites",
};