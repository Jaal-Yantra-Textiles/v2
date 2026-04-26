import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState } from "@medusajs/ui";
import { AdminWebsite } from "../../hooks/api/websites";
import { ActionMenu } from "../common/action-menu";
import { Plus } from "lucide-react";

import { useNavigate } from "react-router-dom";
import { usePagesColumns } from "./hooks/use-pages-columns";
import { AdminPage } from "../../hooks/api/pages";
import { useMemo, useState } from "react";

interface WebsitePagesSectionProps {
  website: AdminWebsite;
}

export function WebsitePagesSection({ website }: WebsitePagesSectionProps) {
  if (!website) return null;

  const navigate = useNavigate();

  const pages = website.pages?.filter(page => page.page_type !== "Blog") || [];

  const columns = usePagesColumns();

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
    filterHelper.accessor("page_type", {
      type: "select",
      label: "Page Type",
      options: [
        { label: "Home", value: "Home" },
        { label: "About", value: "About" },
        { label: "Contact", value: "Contact" },
        { label: "Custom", value: "Custom" },
      ],
    }),
  ];

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState<string>("")

  const filteredPages = useMemo(() => {
    let result = pages;

    // Apply search first
    if (search) {
      result = result.filter((page) => 
        page.title.toLowerCase().includes(search.toLowerCase())
      )
    }

    // Then apply filters
    result = result.filter((page) => {
      return Object.entries(filtering).every(([key, value]) => {
        if (!value) {
          return true
        }
        
        // Get the actual value from the page
        const pageValue = page[key as keyof typeof page]
        console.log('Filtering:', {
          key,
          value,
          pageValue,
          page
        })

        // For status and page_type, do exact match
        if (key === 'status' || key === 'page_type') {
          if (Array.isArray(value)) {
            return value.some(v => v === pageValue)
          }
          return pageValue === value
        }

        // For other string values, do includes match
        if (typeof value === 'string') {
          return pageValue?.toString().toLowerCase().includes(value.toString().toLowerCase())
        }

        return true
      })
    })

    return result
  }, [pages, filtering])

  const paginatedPages = useMemo(() => {
    const start = pagination.pageIndex * pagination.pageSize
    const end = start + pagination.pageSize
    return filteredPages.slice(start, end)
  }, [filteredPages, pagination])
  
  const table = useDataTable({
    columns,
    data: paginatedPages,
    getRowId: (row) => row.id,
    onRowClick: (_, row) => {
      navigate(`/websites/${website.id}/pages/${row.id}`)
    },
    rowCount: filteredPages.length,
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
    }
  });

  return (
    <Container className="divide-y p-0">

      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center">
          <div>
            <Heading>Pages</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              All pages associated with this website
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search />
            <DataTable.FilterMenu tooltip="Filter pages" />
            <ActionMenu groups={[{
              actions: [{
                label: 'Add Pages',
                icon: <Plus />,
                to: `/websites/${website.id}/create`,
              }],
            }]} />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  );
}
