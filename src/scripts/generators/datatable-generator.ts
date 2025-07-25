import { BaseGenerator, ModelStructure } from "./base-generator";
import * as fs from "fs/promises";
import * as path from "path";

export class DataTableGenerator extends BaseGenerator {
  async generateDataTablePage(model: ModelStructure, routePath: string) {
    const routeDir = routePath 
      ? path.join(this.adminRoutesDir, routePath)
      : path.join(this.adminRoutesDir, this.toKebabCase(model.pluralName));
    
    await fs.mkdir(routeDir, { recursive: true });
    
    const pageContent = this.generatePageContent(model, routePath);
    await fs.writeFile(path.join(routeDir, "page.tsx"), pageContent);
    
    console.log(`📊 Generated DataTable page at ${routeDir}`);
  }

  async generateColumnHook(model: ModelStructure) {
    const hookDir = path.join(this.adminHooksDir, "columns");
    await fs.mkdir(hookDir, { recursive: true });
    
    const hookContent = this.generateColumnHookContent(model);
    const hookFile = path.join(hookDir, `use${this.toPascalCase(model.pluralName)}TableColumns.ts`);
    await fs.writeFile(hookFile, hookContent);
    
    console.log(`🔗 Generated column hook at ${hookFile}`);
  }

  private generatePageContent(model: ModelStructure, routePath: string): string {
    const singularPascal = this.toPascalCase(model.name);
    const pluralPascal = this.toPascalCase(model.pluralName);
    const pluralKebab = this.toKebabCase(model.pluralName);
    const singularCamel = this.toCamelCase(model.name);
    const pluralCamel = this.toCamelCase(model.pluralName);

    // Generate filters for filterable fields
    const filters = model.filterableFields.map(field => {
      const fieldCamel = this.toCamelCase(field.name);
      const fieldLabel = field.name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      if (field.isEnum && field.enumValues) {
        const options = field.enumValues.map(val => 
          `        { label: "${val}", value: "${val}" }`
        ).join(',\n');
        
        return `    filterHelper.accessor("${fieldCamel}", {
      type: "select",
      label: "${fieldLabel}",
      options: [
${options}
      ],
    }),`;
      } else if (field.type === 'boolean') {
        return `    filterHelper.accessor("${fieldCamel}", {
      type: "select",
      label: "${fieldLabel}",
      options: [
        { label: "Yes", value: "true" },
        { label: "No", value: "false" }
      ],
    }),`;
      }
      return `    filterHelper.accessor("${fieldCamel}", {
      type: "select",
      label: "${fieldLabel}",
      options: [],
    }),`;
    }).join('\n');

    const searchField = this.toCamelCase(model.fields.find(f => f.isSearchable)?.name || 'name');

    return `import { 
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
import { Admin${singularPascal}, use${pluralPascal} } from "../../../hooks/api/${pluralKebab}";
import { use${pluralPascal}TableColumns } from "../../../hooks/columns/use${pluralPascal}TableColumns";
import { useNavigate } from "react-router-dom";
import debounce from "lodash/debounce";
import { TableSkeleton } from "../../../components/table/skeleton";

const columnHelper = createColumnHelper<Admin${singularPascal}>();
export const useColumns = () => {
  const columns = use${pluralPascal}TableColumns();

  const ${singularCamel}ActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (${singularCamel}: Admin${singularPascal}) => \`${routePath ? `/${routePath}` : `/${pluralKebab}`}/\${${singularCamel}.id}/edit\`,
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
            actionsConfig={${singularCamel}ActionsConfig}
          />
        ),
      }),
    ],
    [columns]
  );
};

const PAGE_SIZE = 20;

const ${pluralPascal}Page = () => {
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
    ${pluralCamel},
    count,
    isLoading,
  } = use${pluralPascal}(
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
  const filterHelper = createDataTableFilterHelper<Admin${singularPascal}>();
  
  const filters = [
${filters}
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
    data: ${pluralCamel} ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => {
      navigate(\`${routePath ? `/${routePath}` : `/${pluralKebab}`}/\${row.id}\`);
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
            <Heading>${pluralPascal}</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your ${model.pluralName} from here
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search ${model.pluralName}..." />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter ${model.pluralName}" />
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

export default ${pluralPascal}Page;

export const config = defineRouteConfig({
  label: "${pluralPascal.replace(/([A-Z])/g, ' $1').trim()}",
  icon: ListBullet,
});

export const handle = {
  breadcrumb: () => "${pluralPascal.replace(/([A-Z])/g, ' $1').trim()}",
};
`;
  }

  private generateColumnHookContent(model: ModelStructure): string {
    const singularPascal = this.toPascalCase(model.name);
    const pluralKebab = this.toKebabCase(model.pluralName);
    
    // Get first 2 fields for columns (as requested)
    const columnFields = model.fields.filter(f => 
      !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name)
    ).slice(0, 2);

    const columns = columnFields.map(field => {
      const fieldCamel = this.toCamelCase(field.name);
      const fieldLabel = field.name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      return `    columnHelper.accessor("${fieldCamel}", {
      header: "${fieldLabel}",
      cell: ({ getValue }) => getValue() || "-",
    }),`;
    }).join('\n');

    return `import { createColumnHelper } from "@tanstack/react-table";
import { Badge } from "@medusajs/ui";
import { Admin${singularPascal} } from "../api/${pluralKebab}";

const columnHelper = createColumnHelper<Admin${singularPascal}>();

export const use${this.toPascalCase(model.pluralName)}TableColumns = () => {
  return [
${columns}
  ];
};
`;
  }
}
