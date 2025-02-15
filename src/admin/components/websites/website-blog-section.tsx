import { Container, Heading, Text, StatusBadge } from "@medusajs/ui";
import { AdminWebsite } from "../../hooks/api/websites";
import { ActionMenu } from "../common/action-menu";
import { Plus } from "lucide-react";

interface WebsiteBlogSectionProps {
  website: AdminWebsite;
}

const blogStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
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

export function WebsiteBlogSection({ website }: WebsiteBlogSectionProps) {
  // Filter pages to only show blogs
  const blogs = website.pages?.filter(page => page.page_type === "Blog") || [];

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Blog Posts</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            All blog posts published on this website
          </Text>
        </div>
        <div className="flex items-center gap-x-4">
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Add Blog Post",
                    icon: <Plus />,
                    to: `/websites/${website.id}/blog`,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      {blogs.length > 0 ? (
        blogs.map((blog) => (
          <div
            key={blog.id}
            className="text-ui-fg-subtle grid grid-cols-3 items-center px-6 py-4"
          >
            <div className="flex flex-col">
              <Text size="small" leading="compact" weight="plus">
                {blog.title}
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {blog.slug}
              </Text>
            </div>
            <div className="flex flex-col">
              <Text size="small" leading="compact">
                {blog.content}
              </Text>
            </div>
            <div className="flex items-center justify-end">
              <StatusBadge color={blogStatusColor(blog.status)}>
                {blog.status}
              </StatusBadge>
            </div>
          </div>
        ))
      ) : (
        <div className="px-6 py-4">
          <Text className="text-ui-fg-subtle" size="small">
            No blog posts found
          </Text>
        </div>
      )}
    </Container>
  );
}
