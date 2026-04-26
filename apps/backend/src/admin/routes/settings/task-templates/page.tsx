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
import { AdminTaskTemplate, useTaskTemplates } from "../../../hooks/api/task-templates";
import { useTaskTemplatesTableColumns } from "../../../hooks/columns/useTaskTemplatesTableColumns";
import { useNavigate } from "react-router-dom";
import debounce from "lodash/debounce";

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
  const navigate = useNavigate();
  
  // State for pagination, filtering, and search
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");
  
  // Calculate the offset based on pagination
  const offset = pagination.pageIndex * pagination.pageSize;
  
  const {
    task_templates,
    count,
    isLoading,
    isError,
    error,
  } = useTaskTemplates(
    {
      limit: pagination.pageSize,
      offset: offset,
      q: search || undefined,
      // Apply filtering - transform filter values to match API expectations
      ...(Object.keys(filtering).length > 0 ? 
        Object.entries(filtering).reduce((acc, [key, value]) => {
          if (key === 'priority') {
            // API expects priority as a direct query param
            acc.priority = value as string;
          } else if (key === 'category') {
            // API expects category name as a direct query param
            acc.category = value as string;
          }
          return acc;
        }, {} as TaskTemplateQuery) : {}),
    },
    {
      placeholderData: keepPreviousData,
    },
  );

  const columns = useColumns();
  
  // Create filters using the filterHelper
  const filterHelper = createDataTableFilterHelper<AdminTaskTemplate>();
  
  // Define a type for the task template query parameters
  type TaskTemplateQuery = {
    priority?: string;
    category?: string;
    q?: string;
    limit?: number;
    offset?: number;
  };
  
  // Extract category options calculation to its own memoized function
  const categoryOptions = useMemo(() => {
    if (!task_templates?.length) return [];
    
    // Extract all categories from templates
    const allCategories = task_templates.reduce((acc: string[], template) => {
      if (template.category) {
        let categoryName = "";
        
        if (typeof template.category === 'string') {
          categoryName = template.category;
        } else if (template.category && typeof template.category === 'object') {
          const categoryObj = template.category as { name?: string };
          categoryName = categoryObj.name || "";
        }
          
        if (categoryName) {
          acc.push(categoryName); // Use push instead of creating a new array each time
        }
      }
      return acc;
    }, []);
    
    // Create unique category list
    const uniqueCategories = [...new Set(allCategories)];
    
    // Convert to options format
    return uniqueCategories.map(category => ({
      label: category,
      value: category
    }));
  }, [task_templates]);
  
  const filters = [
    filterHelper.accessor("priority", {
      type: "select",
      label: "Priority",
      options: [
        { label: "Low", value: "low" },
        { label: "Medium", value: "medium" },
        { label: "High", value: "high" },
      ],
    }),
    filterHelper.accessor("category", {
      type: "select",
      label: "Category",
      options: categoryOptions,
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
    data: task_templates ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => {
      navigate(`/settings/task-templates/${row.id}`);
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

  if (isError) {
    throw error;
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
          <div>
            <Heading>Task Templates</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your task templates from here
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search templates..." />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter templates" />
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

export default TaskTemplatesPage;

export const config = defineRouteConfig({
  label: "Task Templates",
  icon: ListBullet,
});

export const handle = {
  breadcrumb: () => "Task Templates",
};
