import { Container, Heading, Text } from "@medusajs/ui";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Link, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";
import { useWebsites } from "../../hooks/api/websites";
import { useWebsitesTableQuery } from "../../hooks/useWebsitesTableQuery";
import { useWebsitesTableFilters } from "../../hooks/filters/useWebsitesTableFilters";
import { AdminWebsite } from "../../hooks/api/websites";
import { EntityActions } from "../../components/persons/personsActions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardTable } from "../../components/table/card-table";

const WebsitesPage = () => {
  const { searchParams, raw } = useWebsitesTableQuery({ pageSize: 12 });
  const { websites, isLoading, count,  } = useWebsites(
    {
      ...searchParams
    },
    {
      placeholderData: keepPreviousData,
    }
  );

  const filters = useWebsitesTableFilters();

  const renderWebsiteCard = (website: AdminWebsite) => (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{website.name}</CardTitle>
          <Badge
            variant={
              website.status === "Active"
                ? "success"
                : website.status === "Inactive"
                ? "destructive"
                : website.status === "Maintenance"
                ? "warning"
                : "secondary"
            }
          >
            {website.status}
          </Badge>
        </div>
        <CardDescription>
          <a
            href={`https://${website.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            {website.domain}
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div>
            <span className="font-medium">Primary Language:</span>{" "}
            {website.primary_language || "N/A"}
          </div>
          {website.description && (
            <div>
              <span className="font-medium">Description:</span>{" "}
              {website.description}
            </div>
          )}
          <div>
            <span className="font-medium">Created:</span>{" "}
            {new Date(website.created_at).toLocaleDateString()}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <EntityActions
            entity={website}
            actionsConfig={{
              actions: [
                {
                  icon: <PencilSquare />,
                  label: "Edit",
                  to: (website: AdminWebsite) => `/websites/${website.id}/edit`
                },
              ],
            }}
          />
        </div>
      </CardContent>
    </Card>
  );

  const handleSetFilter = (key: string, value: any) => {
    if (key === "q" && (!value || value.length === 0)) {
      handleResetFilter(key);
      return;
    }
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set(key, value);
    window.history.replaceState(null, "", `?${searchParams.toString()}`);
  };

  const handleResetFilter = (key: string) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete(key);
    window.history.replaceState(null, "", `?${searchParams.toString()}`);
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Websites</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage all your websites and public pages from here
          </Text>
        </div>
        <CreateButton />
      </div>

      <div className="p-6">
        <CardTable
          data={websites ?? []}
          count={count || 0}
          pageIndex={searchParams.offset ? searchParams.offset / searchParams.limit : 0}
          pageSize={10}
          filters={filters}
          isLoading={isLoading}
          searchPlaceholder="Search websites..."
          setPageIndex={(index) =>
            handleSetFilter("offset", index * searchParams.limit)
          }
          setPageSize={(size) => handleSetFilter("limit", size)}
          setFilter={handleSetFilter}
          resetFilter={handleResetFilter}
          renderCard={renderWebsiteCard}
        />
      </div>
    </Container>
  );
};

export default WebsitesPage;

export const config = defineRouteConfig({
  label: "Websites",
  icon: Link,
});
