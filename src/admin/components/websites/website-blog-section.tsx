import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState } from "@medusajs/ui";
import { AdminWebsite } from "../../hooks/api/websites";
import { AdminPage } from "../../hooks/api/pages";
import { ActionMenu } from "../common/action-menu";
import { Plus } from "lucide-react";
import { useBlogColumns } from "./hooks/use-blog-columns";
import { useMemo, useState } from "react";

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

  const columns = useBlogColumns();
  const filterHelper = createDataTableFilterHelper<AdminPage>();

  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Draft", value: "Draft" },
        { label: "Published", value: "Published" },
        { label: "Archived", value: "Archived" },
      ],
    }),
  ];

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState<string>("");

  const filteredBlogs = useMemo(() => {
    let result = blogs;

    // Apply search first
    if (search) {
      result = result.filter((blog) => 
        blog.title.toLowerCase().includes(search.toLowerCase())
      )
    }

    // Then apply filters
    result = result.filter((blog) => {
      return Object.entries(filtering).every(([key, value]) => {
        if (!value) {
          return true
        }
        
        // Get the actual value from the blog
        const blogValue = blog[key as keyof typeof blog]
        console.log('Filtering:', {
          key,
          value,
          blogValue,
          blog
        })

        // For status, do exact match
        if (key === 'status') {
          if (Array.isArray(value)) {
            return value.some(v => v === blogValue)
          }
          return blogValue === value
        }

        // For other string values, do includes match
        if (typeof value === 'string') {
          return blogValue?.toString().toLowerCase().includes(value.toString().toLowerCase())
        }

        return true
      })
    })

    return result
  }, [blogs, filtering, search])

  const paginatedBlogs = useMemo(() => {
    const start = pagination.pageIndex * pagination.pageSize
    const end = start + pagination.pageSize
    return filteredBlogs.slice(start, end)
  }, [filteredBlogs, pagination])

  const table = useDataTable({
    columns,
    data: paginatedBlogs,
    getRowId: (row) => row.id,
    rowCount: filteredBlogs.length,
    isLoading: false,
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: setSearch
    },
    filtering: {
      state: filtering,
      onFilteringChange: setFiltering,
    },
  });

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center">
          <div>
            <Heading>Blog Posts</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              All blog posts published on this website
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search />
            <DataTable.FilterMenu tooltip="Filter blog posts" />
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
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  );
}
