import { Container, Heading, Text, StatusBadge } from "@medusajs/ui";
import { AdminWebsite } from "../../hooks/api/websites";
import { ActionMenu } from "../common/action-menu";
import { Plus } from "lucide-react";

interface WebsitePagesSectionProps {
  website: AdminWebsite;
}

const pageStatusColor = (status: string) => {
  switch (status) {
    case "published":
      return "green";
    case "draft":
      return "orange";
    case "archived":
      return "red";
    default:
      return "grey";
  }
};

export function WebsitePagesSection({ website }: WebsitePagesSectionProps) {
  return (
    <Container className="divide-y p-0">
      
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Pages</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            All pages associated with this website
          </Text>
        </div>
        <div className="flex items-center gap-x-4">
          <ActionMenu groups={[{
              actions: [{
                
                label: 'Add Pages',
                icon: <Plus />,
                to: `/websites/${website.id}/create`,
              }],
             
          }]} />
          </div>
      </div>
      {website.pages && website.pages.length > 0 ? (
        website.pages.map((page) => (
          <div key={page.id} className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
            <div className="flex flex-col">
              <Text size="small" leading="compact" weight="plus">
                {page.title}
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {page.slug}
              </Text>
            </div>
            <div className="flex items-center justify-end">
              <StatusBadge color={pageStatusColor(page.status)}>
                {page.status}
              </StatusBadge>
              
            </div>
          </div>
        ))
      ) : (
        <div className="px-6 py-4">
          <Text className="text-ui-fg-subtle" size="small">
            No pages found
          </Text>
        </div>
      )}
    </Container>
  );
}
