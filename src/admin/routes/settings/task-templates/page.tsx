import { Container, Heading, Text } from "@medusajs/ui";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ListBullet, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../../components/creates/create-button";
import { useMemo } from "react";
import { DataTable } from "../../../components/table/data-table";
import { useDataTable } from "../../../hooks/usedataTable";
import { EntityActions } from "../../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import { AdminTaskTemplate, useTaskTemplates } from "../../../hooks/api/task-templates";
import { useTaskTemplatesTableFilters } from "../../../hooks/filters/useTaskTemplatesTableFilters";
import { useTaskTemplatesTableColumns } from "../../../hooks/columns/useTaskTemplatesTableColumns";
import { useTaskTemplatesTableQuery } from "../../../hooks/queries/task-templates/useTaskTemplatesTableQuery";

const columnHelper = createColumnHelper<AdminTaskTemplate>();
export const useColumns = () => {
  const columns = useTaskTemplatesTableColumns();

  const taskTemplateActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (template: AdminTaskTemplate) => `/settings/task-templates/${template.id}/edit`,
      },
      // Add more actions as needed
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
            actionsConfig={taskTemplateActionsConfig}
          />
        ),
      }),
    ],
    [columns],
  );
};

const TaskTemplatesPage = () => {
  const { searchParams, raw } = useTaskTemplatesTableQuery({ pageSize: 10, });

  const {
    task_templates,
    count,
    isLoading,
    isError,
    error,
  } = useTaskTemplates(
    {
      ...searchParams,
      ...raw
    },
    {
      placeholderData: keepPreviousData,
    },
  );

  const filters = useTaskTemplatesTableFilters();
  const columns = useColumns();

  const { table } = useDataTable({
    data: task_templates ?? [],
    columns,
    count,
    enablePagination: true,
    getRowId: (row) => row.id as string,
    pageSize: 10,
  });

  if (isError) {
    throw error;
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Task Templates</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage all your task templates from here
          </Text>
        </div>
        <CreateButton />
      </div>
      <DataTable
        table={table}
        columns={columns}
        pageSize={10}
        count={count}
        filters={filters}
        orderBy={[
          { key: "name", label: "Name" },
          { key: "priority", label: "Priority" },
          { key: "category", label: "Category" }
        ]}
        isLoading={isLoading}
        navigateTo={(row) => `/settings/task-templates/${row.original.id}`}
        search
      />
    </Container>
  );
};

export default TaskTemplatesPage;

export const config = defineRouteConfig({
  label: "Task Templates",
    icon: ListBullet,
});
