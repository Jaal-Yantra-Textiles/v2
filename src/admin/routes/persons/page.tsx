import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState, Button } from "@medusajs/ui";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Users } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";
import { usePersons } from "../../hooks/api/persons";
import { useMemo, useState, useCallback } from "react";
import { usePersonTableColumns } from "../../hooks/columns/usePersonTableColumns";
import { AdminPerson, AdminPersonsListParams } from "../../hooks/api/personandtype";
import debounce from "lodash/debounce";



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
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);
  
  // Debounced filter change handler to prevent rapid re-renders and API calls
  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      setFiltering(newFilters);
    }, 300),
    []
  );

  // Debounced search change handler
  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch);
    }, 300),
    []
  );
  
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
      withDeleted: includeDeleted, 
      // Apply filtering only for known fields
      ...(Object.keys(filtering).length > 0 ? 
        Object.entries(filtering).reduce((acc: AdminPersonsListParams, [key, value]) => {
          if (!value) return acc;
          
          // Handle different filter types appropriately
          if (key === 'email') {
            // Ensure email is a string, not an array
            acc.email = Array.isArray(value) && value.length > 0 ? value[0] : value as string;
          } else if (key === 'state') {
            acc.state = Array.isArray(value) && value.length > 0 ? value[0] : value as string;
          } else if (key === 'first_name') {
            acc.first_name = Array.isArray(value) && value.length > 0 ? value[0] : value as string;
          } else if (key === 'last_name') {
            acc.last_name = Array.isArray(value) && value.length > 0 ? value[0] : value as string;
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
    filterHelper.accessor("first_name", {
      type: "select",
      label: "First Name",
      options: useMemo(() => {
        if (!persons?.length) return [];
        const uniqueFirstNames = [...new Set(persons.map(p => p.first_name))];
        return uniqueFirstNames.map(name => ({
          label: name || "",
          value: name || ""
        }));
      }, [persons]),
    }),
    filterHelper.accessor("last_name", {
      type: "select",
      label: "Last Name",
      options: useMemo(() => {
        if (!persons?.length) return [];
        const uniqueLastNames = [...new Set(persons.map(p => p.last_name))];
        return uniqueLastNames.map(name => ({
          label: name || "",
          value: name || ""
        }));
      }, [persons]),
    }),
    filterHelper.accessor("state", {
      type: "select",
      label: "State",
      options: [
        { label: "Onboarding", value: "Onboarding" },
        { label: "Onboarding Finished", value: "Onboarding Finished" },
        { label: "Stalled", value: "Stalled" },
        { label: "Conflicted", value: "Conflicted" },
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
      onSearchChange: handleSearchChange,
    },
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
    },
  });

  if (isError) {
    throw error;
  }

  return (
    <>
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
                <Button size="small" variant="secondary" asChild>
                  <Link to="map">Show Map View</Link>
                </Button>
            </div>
          </DataTable.Toolbar>
          
          {/* Search and filter section in its own container with divider */}
          <div className="flex items-start justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
            <div className="w-full max-w-[60%] flex items-center gap-x-4">
              <DataTable.FilterMenu tooltip="Filter persons" />
              <div className="flex items-center gap-x-2">
                <input 
                  type="checkbox" 
                  id="include-deleted" 
                  checked={includeDeleted}
                  onChange={(e) => setIncludeDeleted(e.target.checked)}
                  className="h-4 w-4 rounded border-ui-border-base text-ui-fg-interactive"
                />
                <label htmlFor="include-deleted" className="text-ui-fg-subtle text-sm">
                  Include deleted persons
                </label>
              </div>
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
      </>
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

