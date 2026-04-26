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
import { AdminEmailTemplate, useEmailTemplates } from "../../../hooks/api/email-templates";
import { useEmailTemplatesTableColumns } from "../../../hooks/columns/useEmailTemplatesTableColumns";
import { useNavigate } from "react-router-dom";
import debounce from "lodash/debounce";
import { TableSkeleton } from "../../../components/table/skeleton";

const columnHelper = createColumnHelper<AdminEmailTemplate>();
export const useColumns = () => {
  const columns = useEmailTemplatesTableColumns();

  const emailTemplateActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (emailTemplate: AdminEmailTemplate) => `/settings/email-templates/${emailTemplate.id}/edit`,
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
            actionsConfig={emailTemplateActionsConfig}
          />
        ),
      }),
    ],
    [columns]
  );
};

const PAGE_SIZE = 20;

const EmailTemplatesPage = () => {
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
    emailTemplates,
    count,
    isLoading,
  } = useEmailTemplates(
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
  const filterHelper = createDataTableFilterHelper<AdminEmailTemplate>();
  
  const filters = [
    filterHelper.accessor("name", {
      type: "select",
      label: "Name",
      options: [],
    }),
    filterHelper.accessor("description", {
      type: "select",
      label: "Description",
      options: [],
    }),
    filterHelper.accessor("to", {
      type: "select",
      label: "To",
      options: [],
    }),
    filterHelper.accessor("cc", {
      type: "select",
      label: "Cc",
      options: [],
    }),
    filterHelper.accessor("bcc", {
      type: "select",
      label: "Bcc",
      options: [],
    }),
    filterHelper.accessor("from", {
      type: "select",
      label: "From",
      options: [],
    }),
    filterHelper.accessor("templateKey", {
      type: "select",
      label: "Template Key",
      options: [],
    }),
    filterHelper.accessor("subject", {
      type: "select",
      label: "Subject",
      options: [],
    }),
    filterHelper.accessor("htmlContent", {
      type: "select",
      label: "Html Content",
      options: [],
    }),
    filterHelper.accessor("variables", {
      type: "select",
      label: "Variables",
      options: [],
    }),
    filterHelper.accessor("isActive", {
      type: "select",
      label: "Is Active",
      options: [
        { label: "Yes", value: "true" },
        { label: "No", value: "false" }
      ],
    }),
    filterHelper.accessor("templateType", {
      type: "select",
      label: "Template Type",
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
    data: emailTemplates ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => {
      navigate(`/settings/email-templates/${row.id}`);
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
            <Heading>Email Templates</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your email-templates from here
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search email-templates..." />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter email-templates" />
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

export default EmailTemplatesPage;

export const config = defineRouteConfig({
  label: "Email Templates",
  icon: ListBullet,
});

export const handle = {
  breadcrumb: () => "Email Templates",
};

