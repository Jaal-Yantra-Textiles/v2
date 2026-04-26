import { 
  Container, 
  Heading, 
  Text, 
  DataTable, 
  useDataTable, 
  createDataTableFilterHelper,
  DataTablePaginationState,
  DataTableFilteringState 
} from "@medusajs/ui";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ListBullet, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../../components/creates/create-button";
import { useMemo, useState, useCallback } from "react";
import { EntityActions } from "../../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import { useAgreementsTableColumns } from "../../../hooks/columns/useAgreementsTableColumns";
import { useNavigate } from "react-router-dom";
import debounce from "lodash/debounce";
import { TableSkeleton } from "../../../components/table/skeleton";
import { AdminAgreement, useAgreements } from "../../../hooks/api/agreement";

const columnHelper = createColumnHelper<AdminAgreement>();
export const useColumns = () => {
  const columns = useAgreementsTableColumns();

  const agreementActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (agreement: AdminAgreement) => `/settings/agreements/${agreement.id}/edit`,
      },
    ],
  };

  return useMemo(
    () => [
      ...columns,
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <EntityActions
            entity={row.original}
            actionsConfig={agreementActionsConfig}
          />
        ),
      }),
    ],
    [columns]
  );
};

const PAGE_SIZE = 20;

const AgreementsPage = () => {
  const navigate = useNavigate();
  
  // State for pagination, filtering, and search
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: PAGE_SIZE,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");
  
  // Calculate the offset based on pagination
  const offset = pagination.pageIndex * pagination.pageSize;
  
  const {
    agreements,
    count,
    isLoading,
  } = useAgreements(
    {
      limit: pagination.pageSize,
      offset: offset,
      q: search || undefined,
      // Apply filtering - transform filter values to match API expectations
      ...(Object.keys(filtering).length > 0 ? 
        Object.entries(filtering).reduce((acc, [key, value]) => {
          acc[key] = value as string;
          return acc;
        }, {} as any) : {}),
    },
    {
      placeholderData: keepPreviousData,
    },
  );

  const columns = useColumns();
  
  // Create filters using the filterHelper
  const filterHelper = createDataTableFilterHelper<AdminAgreement>();
  
  const filters = [
    filterHelper.accessor("title", {
      type: "select",
      label: "Title",
      options: [],
    }),
    filterHelper.accessor("content", {
      type: "select",
      label: "Content",
      options: [],
    }),
    filterHelper.accessor("templateKey", {
      type: "select",
      label: "Template Key",
      options: [],
    }),
    filterHelper.accessor("optional", {
      type: "select",
      label: "Optional",
      options: [],
    }),
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [],
    }),
    filterHelper.accessor("validFrom", {
      type: "select",
      label: "Valid From",
      options: [],
    }),
    filterHelper.accessor("validUntil", {
      type: "select",
      label: "Valid Until",
      options: [],
    }),
    filterHelper.accessor("subject", {
      type: "select",
      label: "Subject",
      options: [],
    }),
    filterHelper.accessor("fromEmail", {
      type: "select",
      label: "From Email",
      options: [],
    }),
    filterHelper.accessor("sentCount", {
      type: "select",
      label: "Sent Count",
      options: [],
    }),
    filterHelper.accessor("responseCount", {
      type: "select",
      label: "Response Count",
      options: [],
    }),
    filterHelper.accessor("agreedCount", {
      type: "select",
      label: "Agreed Count",
      options: [],
    }),
    filterHelper.accessor("metadata", {
      type: "select",
      label: "Metadata",
      options: [],
    }),
    filterHelper.accessor("responses", {
      type: "select",
      label: "Responses",
      options: [],
    }),
    filterHelper.accessor("mappedBy", {
      type: "select",
      label: "MappedBy",
      options: [],
    }),
  ];

  // Debounced filter change handler to prevent rapid re-renders
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

  const table = useDataTable({
    columns,
    data: agreements ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => {
      navigate(`/settings/agreements/${row.id}`);
    },
    rowCount: count,
    isLoading,
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

  if (isLoading) {
    return (
      <TableSkeleton layout="fill" rowCount={10} search={true} filters={true} orderBy={true} pagination={true} />
    )
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
          <div>
            <Heading>Agreements</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your agreements from here
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search agreements..." />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter agreements" />
              <CreateButton />
            </div>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  );
};

export default AgreementsPage;

export const config = defineRouteConfig({
  label: "Agreements",
  icon: ListBullet,
});

export const handle = {
  breadcrumb: () => "Agreements",
};
