import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState, DropdownMenu, Button } from "@medusajs/ui";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Users, ChevronDownMini } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";
import { usePersons } from "../../hooks/api/persons";
import { useMemo, useState } from "react";
import { usePersonTableColumns } from "../../hooks/columns/usePersonTableColumns";
import { AdminPerson, AdminPersonsListParams } from "../../hooks/api/personandtype";



export const useColumns = () => {
  const columns = usePersonTableColumns();

  return useMemo(
    () => [
      ...columns,
    ],
    [columns],
  );
};

const PersonsPage = () => {
  const navigate = useNavigate();
  
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");
  
  // Calculate the offset based on pagination
  const offset = pagination.pageIndex * pagination.pageSize;
  
  const {
    persons, 
    count,
    isLoading,
    isError,
    error,
  } = usePersons(
    {
      limit: pagination.pageSize,
      offset: offset,
      q: search || undefined, 
      // Apply filtering only for known fields
      ...(Object.keys(filtering).length > 0 ? 
        Object.entries(filtering).reduce((acc: AdminPersonsListParams, [key, value]) => {
          if (!value) return acc;
          
          // Handle different filter types appropriately
          if (key === 'email') {
            acc.email = value as string;
          } else if (key === 'state') {
            acc.state = value as string;
          }
          return acc;
        }, {} as AdminPersonsListParams) : {}),
    },
    {
      // Use the staleTime option instead of keepPreviousData
      staleTime: 30000,
    },
  );

  const columns = useColumns();
  
  const filterHelper = createDataTableFilterHelper<AdminPerson>();
  
  // Create filters using the filterHelper
  const filters = [
    filterHelper.accessor("email", {
      type: "select",
      label: "Email",
      options: useMemo(() => {
        if (!persons?.length) return [];
        
        // Extract unique emails
        const uniqueEmails = [...new Set(persons.map(p => p.email))];
        
        // Convert to options format
        return uniqueEmails.map(email => ({
          label: email || "",
          value: email || ""
        }));
      }, [persons]),
    }),
    filterHelper.accessor("state", {
      type: "select",
      label: "State",
      options: [
        { label: "Active", value: "active" },
        { label: "Inactive", value: "inactive" },
        { label: "Pending", value: "pending" },
      ],
    }),
  ];

  const table = useDataTable({
    columns,
    data: persons ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => {
      navigate(`/persons/${row.id}`);
    },
    rowCount: count ?? 0,
    isLoading: isLoading ?? false,
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: setSearch,
    },
    filtering: {
      state: filtering,
      onFilteringChange: setFiltering,
    },
  });

  if (isError) {
    throw error;
  }

  return (
    <div>
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          {/* Header section with title and create button */}
          <DataTable.Toolbar className="flex justify-between items-center px-6 py-4">
            <div>
              <Heading>Persons</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Manage all your relationships from here
              </Text>
            </div>
            <div className="flex items-center justify-center gap-x-2">
                <CreateButton />
                <Button size="small" variant="secondary" asChild>
                <Link to="import">Import</Link>
          </Button>
            </div>
          </DataTable.Toolbar>
          
          {/* Search and filter section in its own container with divider */}
          <div className="flex items-start justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
            <div className="w-full max-w-[60%]">
              <DataTable.FilterMenu tooltip="Filter persons" />
            </div>
            <div className="flex shrink-0 items-center gap-x-2">
              <DataTable.Search placeholder="Search persons..." />
            </div>
          </div>
          
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
      <Outlet />
    </div>
  );
};

export default PersonsPage;



export const config = defineRouteConfig({
  label: "People",
  icon: Users,
});


export const handle = {
  breadcrumb: () => "People",
};

