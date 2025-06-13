import { Container, Heading, Text, DataTable, useDataTable, DataTablePaginationState, DataTableFilteringState } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { usePersonTypes } from "../../../hooks/api/persontype";
import { usePersonTypeTableColumns } from "./components/use-person-type-table-columns";
import { useState, useCallback } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { ActionCell } from "./components/action-cell";
import { createColumnHelper } from "@tanstack/react-table";
import { AdminPersonType } from "../../../hooks/api/personandtype";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { DocumentSeries } from "@medusajs/icons";
import CreateButton from "../../../components/creates/create-button";
import { usePersonTypeTableFilters } from "./components/use-person-type-table-filters";
import debounce from "lodash/debounce";
import { useNavigate } from "react-router-dom";

const PAGE_SIZE = 20;
const columnHelper = createColumnHelper<AdminPersonType>();

const PersonTypesPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState("");

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch);
    }, 300),
    []
  );

  const { personTypes, count, isLoading, isError, error } = usePersonTypes(
    {
      limit: pagination.pageSize,
      offset: pagination.pageIndex * pagination.pageSize,
      q: search,
      ...filtering,
    },
    {
      placeholderData: keepPreviousData,
    }
  );

  const filters = usePersonTypeTableFilters(personTypes);
  const baseColumns = usePersonTypeTableColumns();

  const columns = [
    ...baseColumns,
    columnHelper.display({
      id: "actions",
      cell: ({ row }) => <ActionCell personType={row.original} />,
    }),
  ];

  const table = useDataTable({
    data: personTypes || [],
    columns,
    rowCount: count || 0,
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => {
      navigate(`/settings/persontypes/${row.id}`);
    },
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
      onFilteringChange: setFiltering,
    },
    filters,
    isLoading,
  });

  if (isError) {
    throw error;
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>{t("Person Types")}</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              {t("You create the type of the people and its description")}
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search placeholder={t("Search person types")} />
            <DataTable.FilterMenu />
            <CreateButton />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "Person Types",
  icon: DocumentSeries,
});

export const handle = {
  breadcrumb: () => "Person Types",
};

export default PersonTypesPage;