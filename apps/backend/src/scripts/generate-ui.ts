#!/usr/bin/env node

/**
 * UI Generation Script
 * 
 * This script automatically generates admin UI components with Data Tables,
 * filters, search functionality, and CRUD routes based on model definitions.
 * 
 * Usage: npx medusa exec ./scripts/generate-ui.ts --model=emailtemplates --route=settings/email-templates
 */

import fs from "fs/promises";
import path from "path";

// Helper functions for naming conventions
const toPascalCase = (str: string) =>
  str.replace(/(^\w|-\w)/g, (g) => g.replace(/-/, "").toUpperCase());
const toCamelCase = (str: string) => {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};
const toSingular = (str: string) => {
  if (str.endsWith('ies')) {
    return str.slice(0, -3) + 'y';
  }
  if (str.endsWith('s') && !str.endsWith('ss')) {
    return str.slice(0, -1);
  }
  return str;
};
const toKebabCase = (str: string) => 
  str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

interface ModelField {
  name: string;
  type: string;
  isOptional: boolean;
  isEnum: boolean;
  enumValues?: string[];
  isSearchable: boolean;
  isFilterable: boolean;
  defaultValue?: string;
}

interface ModelStructure {
  name: string;
  pluralName: string;
  fields: ModelField[];
  hasSearchableFields: boolean;
  filterableFields: ModelField[];
  enumFields: ModelField[];
}

class UIGenerator {
  private projectRoot: string;
  private modelsDir: string;
  private adminRoutesDir: string;
  private adminComponentsDir: string;
  private adminHooksDir: string;
  private apiDir: string;

  constructor() {
    this.projectRoot = path.join(__dirname, "..");
    this.modelsDir = path.join(this.projectRoot, "/modules");
    this.adminRoutesDir = path.join(this.projectRoot, "/admin/routes");
    this.adminComponentsDir = path.join(this.projectRoot, "/admin/components");
    this.adminHooksDir = path.join(this.projectRoot, "/admin/hooks");
    this.apiDir = path.join(this.projectRoot, "/api/admin");
  }

  async generate(modelName: string, routePath: string = "") {
    console.log(`🔍 Analyzing model ${modelName}...`);

    const modelStructure = await this.analyzeModel(modelName);
    if (!modelStructure) {
      console.error(`❌ Could not find model ${modelName}`);
      return;
    }

    console.log(`📋 Found model structure:`, {
      name: modelStructure.name,
      pluralName: modelStructure.pluralName,
      fieldsCount: modelStructure.fields.length,
      hasSearchableFields: modelStructure.hasSearchableFields,
      filterableFieldsCount: modelStructure.filterableFields.length,
    });

    // Generate components
    await this.generateDataTablePage(modelStructure, routePath);
    await this.generateColumnHook(modelStructure);
    await this.generateCreateRoute(modelStructure, routePath);
    await this.generateEditRoute(modelStructure, routePath);

    console.log(`✅ Generated UI components for ${modelName}`);
  }

  private async analyzeModel(modelName: string): Promise<ModelStructure | null> {
    try {
      // Find the model file
      const modelPath = await this.findModelFile(modelName);
      if (!modelPath) {
        return null;
      }

      const modelContent = await fs.readFile(modelPath, "utf-8");
      
      // Parse model fields
      const fields = this.parseModelFields(modelContent);
      
      const pluralName = modelName.endsWith('s') ? modelName : `${modelName}s`;
      
      return {
        name: toSingular(modelName),
        pluralName: modelName,
        fields,
        hasSearchableFields: fields.some(f => f.isSearchable),
        filterableFields: fields.filter(f => f.isFilterable),
        enumFields: fields.filter(f => f.isEnum),
      };
    } catch (error) {
      console.error(`Error analyzing model ${modelName}:`, error);
      return null;
    }
  }

  private async findModelFile(modelName: string): Promise<string | null> {
    try {
      // Look for model in modules directory
      const moduleDirs = await fs.readdir(this.modelsDir);
      
      for (const moduleDir of moduleDirs) {
        const modulePath = path.join(this.modelsDir, moduleDir);
        const stat = await fs.stat(modulePath);
        
        if (stat.isDirectory()) {
          const modelsPath = path.join(modulePath, "models");
          try {
            const modelFiles = await fs.readdir(modelsPath);
            const modelFile = modelFiles.find(f => 
              f.includes(toSingular(modelName).toLowerCase()) || 
              f.includes(modelName.toLowerCase())
            );
            
            if (modelFile) {
              return path.join(modelsPath, modelFile);
            }
          } catch {
            // Models directory doesn't exist in this module
            continue;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error("Error finding model file:", error);
      return null;
    }
  }

  private parseModelFields(modelContent: string): ModelField[] {
    const fields: ModelField[] = [];
    
    // Parse field definitions
    const fieldRegex = /(\w+):\s*model\.(string|number|boolean|enum|text|json|dateTime)\(([^)]*)\)/g;
    let match;
    
    while ((match = fieldRegex.exec(modelContent)) !== null) {
      const [, fieldName, fieldType, options] = match;
      
      // Skip system fields
      if (['id', 'created_at', 'updated_at', 'deleted_at'].includes(fieldName)) {
        continue;
      }
      
      const isOptional = options.includes('optional: true');
      const isSearchable = options.includes('searchable: true') || fieldType === 'string' || fieldType === 'text';
      const isFilterable = fieldType === 'enum' || fieldType === 'boolean' || options.includes('filterable: true');
      
      let isEnum = false;
      let enumValues: string[] = [];
      
      if (fieldType === 'enum') {
        isEnum = true;
        // Try to extract enum values
        const enumMatch = options.match(/values:\s*\[([^\]]+)\]/);
        if (enumMatch) {
          enumValues = enumMatch[1].split(',').map(v => v.trim().replace(/['"]/g, ''));
        }
      }
      
      // Extract default value
      let defaultValue: string | undefined;
      const defaultMatch = options.match(/default:\s*['"]([^'"]+)['"]/);
      if (defaultMatch) {
        defaultValue = defaultMatch[1];
      }
      
      fields.push({
        name: fieldName,
        type: fieldType,
        isOptional,
        isEnum,
        enumValues,
        isSearchable,
        isFilterable,
        defaultValue,
      });
    }
    
    return fields;
  }

  private async generateDataTablePage(model: ModelStructure, routePath: string) {
    const routeDir = routePath 
      ? path.join(this.adminRoutesDir, routePath)
      : path.join(this.adminRoutesDir, toKebabCase(model.pluralName));
    
    await fs.mkdir(routeDir, { recursive: true });
    
    const pageContent = this.generatePageContent(model, routePath);
    await fs.writeFile(path.join(routeDir, "page.tsx"), pageContent);
    
    console.log(`📄 Generated page.tsx at ${routeDir}`);
  }

  private generatePageContent(model: ModelStructure, routePath: string): string {
    const singularPascal = toPascalCase(model.name);
    const pluralPascal = toPascalCase(model.pluralName);
    const singularCamel = toCamelCase(model.name);
    const pluralCamel = toCamelCase(model.pluralName);
    
    const routePrefix = routePath ? `/${routePath}` : `/${toKebabCase(model.pluralName)}`;
    
    // Generate filter helper calls
    const filterCalls = model.filterableFields.map(field => {
      if (field.isEnum && field.enumValues) {
        const options = field.enumValues.map(val => `        { label: "${val}", value: "${val}" }`).join(',\n');
        return `    filterHelper.accessor("${field.name}", {
      type: "select",
      label: "${field.name.charAt(0).toUpperCase() + field.name.slice(1)}",
      options: [
${options}
      ],
    }),`;
      } else if (field.type === 'boolean') {
        return `    filterHelper.accessor("${field.name}", {
      type: "select",
      label: "${field.name.charAt(0).toUpperCase() + field.name.slice(1)}",
      options: [
        { label: "Yes", value: "true" },
        { label: "No", value: "false" }
      ],
    }),`;
      }
      return `    filterHelper.accessor("${field.name}", {
      type: "select",
      label: "${field.name.charAt(0).toUpperCase() + field.name.slice(1)}",
    }),`;
    }).join('\n');

    const searchField = model.fields.find(f => f.isSearchable)?.name || 'name';

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
import { Admin${singularPascal}, use${pluralPascal} } from "../../../hooks/api/${toKebabCase(model.pluralName)}";
import { use${pluralPascal}TableColumns } from "../../../hooks/columns/use${pluralPascal}TableColumns";
import { useNavigate } from "react-router-dom";
import debounce from "lodash/debounce";

const columnHelper = createColumnHelper<Admin${singularPascal}>();
export const useColumns = () => {
  const columns = use${pluralPascal}TableColumns();

  const ${singularCamel}ActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (${singularCamel}: Admin${singularPascal}) => \`${routePrefix}/\${${singularCamel}.id}/edit\`,
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
const PREFIX = "${pluralCamel}";

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
    isError,
    error,
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
${filterCalls}
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
      navigate(\`${routePrefix}/\${row.id}\`);
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
    return <div>Loading...</div>;
  }

  if (isError) {
    return <div>Error loading ${model.pluralName}: {error?.message}</div>;
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
  label: "${pluralPascal}",
  icon: ListBullet,
});

export const breadcrumb = () => "${pluralPascal}";
`;
  }

  private async generateColumnHook(model: ModelStructure) {
    const hookDir = path.join(this.adminHooksDir, "columns");
    await fs.mkdir(hookDir, { recursive: true });
    
    const hookContent = this.generateColumnHookContent(model);
    const fileName = `use${toPascalCase(model.pluralName)}TableColumns.ts`;
    await fs.writeFile(path.join(hookDir, fileName), hookContent);
    
    console.log(`🪝 Generated column hook: ${fileName}`);
  }

  private generateColumnHookContent(model: ModelStructure): string {
    const singularPascal = toPascalCase(model.name);
    const pluralPascal = toPascalCase(model.pluralName);
    
    // Generate column definitions for key fields
    const displayFields = model.fields.filter(f => 
      !['password', 'token', 'secret'].some(secret => f.name.toLowerCase().includes(secret))
    ).slice(0, 5); // Limit to first 5 relevant fields

    const columnDefinitions = displayFields.map(field => {
      if (field.type === 'boolean') {
        return `    columnHelper.accessor("${field.name}", {
      header: "${toPascalCase(field.name)}",
      cell: ({ getValue }) => (
        <Badge variant={getValue() ? "green" : "grey"}>
          {getValue() ? "Yes" : "No"}
        </Badge>
      ),
    }),`;
      } else if (field.isEnum) {
        return `    columnHelper.accessor("${field.name}", {
      header: "${toPascalCase(field.name)}",
      cell: ({ getValue }) => (
        <Badge variant="default">
          {getValue()}
        </Badge>
      ),
    }),`;
      } else if (field.type === 'dateTime') {
        return `    columnHelper.accessor("${field.name}", {
      header: "${toPascalCase(field.name)}",
      cell: ({ getValue }) => {
        const date = getValue();
        return date ? new Date(date).toLocaleDateString() : "-";
      },
    }),`;
      } else {
        return `    columnHelper.accessor("${field.name}", {
      header: "${toPascalCase(field.name)}",
      cell: ({ getValue }) => getValue() || "-",
    }),`;
      }
    }).join('\n');

    return `import { createColumnHelper } from "@tanstack/react-table";
import { Badge } from "@medusajs/ui";
import { Admin${singularPascal} } from "../api/${toKebabCase(model.pluralName)}";

const columnHelper = createColumnHelper<Admin${singularPascal}>();

export const use${pluralPascal}TableColumns = () => {
  return [
${columnDefinitions}
  ];
};
`;
  }

  private async generateCreateRoute(model: ModelStructure, routePath: string) {
    const routeDir = routePath 
      ? path.join(this.adminRoutesDir, routePath)
      : path.join(this.adminRoutesDir, toKebabCase(model.pluralName));
    
    const createDir = path.join(routeDir, "create");
    await fs.mkdir(createDir, { recursive: true });
    
    // Generate the create component file
    await this.generateCreateComponent(model);
    
    // Generate the create page that uses the component
    const createPageContent = this.generateCreatePageContent(model, routePath);
    await fs.writeFile(path.join(createDir, "page.tsx"), createPageContent);
    
    console.log(`➕ Generated create route at ${createDir}`);
  }

  private async generateCreateComponent(model: ModelStructure) {
    const componentDir = path.join(this.adminComponentsDir, "creates");
    await fs.mkdir(componentDir, { recursive: true });
    
    const componentContent = this.generateCreateComponentContent(model);
    const componentFile = path.join(componentDir, `create-${toKebabCase(model.name)}.tsx`);
    await fs.writeFile(componentFile, componentContent);
    
    console.log(`🧩 Generated create component at ${componentFile}`);
  }

  private generateCreatePageContent(model: ModelStructure, routePath: string): string {
    const singularPascal = toPascalCase(model.name);
    const singularKebab = toKebabCase(model.name);
    
    return `import { Create${singularPascal} } from "../../../../components/creates/create-${singularKebab}";
    import { RouteFocusModal } from "../../../../components/modal/route-focus-modal";

const Create${singularPascal}Modal = () => {
  return <RouteFocusModal><Create${singularPascal} /></RouteFocusModal>;
};

export default Create${singularPascal}Modal;
`;
  }

  private generateCreateComponentContent(model: ModelStructure): string {
    const singularPascal = toPascalCase(model.name);
    const singularCamel = toCamelCase(model.name);
    
    // Get form fields (exclude system fields)
    const columnFields = model.fields.filter(f => 
      !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name)
    ).slice(0, 2); // Limit to first 2 fields for columns validation
    const formFields = model.fields.filter(f => 
      !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name)
    );

    // Generate schema fields for zod validation
    const schemaFields = formFields.map(field => {
      if (field.type === 'boolean') {
        return `  ${field.name}: z.boolean().optional(),`;
      } else if (field.isEnum && field.enumValues) {
        const enumValues = field.enumValues.map(v => `"${v}"`).join(', ');
        return `  ${field.name}: z.enum([${enumValues}]).optional(),`;
      } else if (field.type === 'number') {
        return `  ${field.name}: z.number().optional(),`;
      } else {
        const required = field.name === 'name' ? '.min(1, "Name is required")' : '.optional()';
        return `  ${field.name}: z.string()${required},`;
      }
    }).join('\n');

    // Generate Form.Field components
    const formFieldsJsx = formFields.map(field => {
      const fieldLabel = field.name.charAt(0).toUpperCase() + field.name.slice(1);
      
      if (field.type === 'boolean') {
        return `                  <Form.Field
                    control={form.control}
                    name="${field.name}"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <div className="flex items-center space-x-2">
                            <Form.Control>
                              <Checkbox
                                id="${field.name}"
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </Form.Control>
                            <Form.Label htmlFor="${field.name}">${fieldLabel}</Form.Label>
                          </div>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />`;
      } else if (field.isEnum && field.enumValues) {
        const options = field.enumValues.map(val => 
          `                            <Select.Item value="${val}">${val}</Select.Item>`
        ).join('\n');
        return `                  <Form.Field
                    control={form.control}
                    name="${field.name}"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <Form.Label>${fieldLabel}</Form.Label>
                          <Form.Control>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <Select.Trigger>
                                <Select.Value placeholder="Select ${field.name}" />
                              </Select.Trigger>
                              <Select.Content>
${options}
                              </Select.Content>
                            </Select>
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />`;
      } else {
        return `                  <Form.Field
                    control={form.control}
                    name="${field.name}"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <Form.Label>${fieldLabel}</Form.Label>
                          <Form.Control>
                            <Input
                              placeholder="Enter ${field.name}"
                              {...field}
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />`;
      }
    }).join('\n');

    return `import { Button, Heading, Text, Input, Select, Checkbox, toast } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "@medusajs/framework/zod";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useRouteModal } from "../modal/use-route-modal";
import { Form } from "../common/form";
import { useCreate${toPascalCase(model.pluralName)} } from "../../hooks/api/${toKebabCase(model.pluralName)}";

// Define the schema for ${singularCamel} creation
const ${singularCamel}Schema = z.object({
${schemaFields}
});

type ${singularPascal}FormValues = z.infer<typeof ${singularCamel}Schema>;

export function Create${singularPascal}() {
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useCreate${toPascalCase(model.pluralName)}();

  // Initialize form with validation
  const form = useForm<${singularPascal}FormValues>({
    resolver: zodResolver(${singularCamel}Schema),
    defaultValues: {
${formFields.map(f => `      ${f.name}: ${f.type === 'boolean' ? 'false' : f.type === 'number' ? '0' : '""'},`).join('\n')}
    },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await mutateAsync(
        data,
        {
          onSuccess: ({ ${singularCamel} }) => {
            toast.success(\`\${${singularCamel}.name || '${singularPascal}'} created successfully\`);
            handleSuccess(\`/${toKebabCase(model.pluralName)}/\${${singularCamel}.id}\`);
          },
          onError: (error) => {
            toast.error(error.message || "Failed to create ${singularCamel}");
          },
        }
      );
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred");
    }
  });

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-1 flex-col overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create ${singularPascal}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Create a new ${singularCamel}
              </Text>
            </div>
            
            <div className="flex flex-col gap-y-4">
${formFieldsJsx}
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              Create
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
}
`;
  }

  private generateCreateContent(model: ModelStructure, routePath: string): string {
    const singularPascal = toPascalCase(model.name);
    const pluralPascal = toPascalCase(model.pluralName);
    const singularCamel = toCamelCase(model.name);
    
    const routePrefix = routePath ? `/${routePath}` : `/${toKebabCase(model.pluralName)}`;
    
    // Generate form fields for non-system fields
    const formFields = model.fields.filter(f => 
      !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name)
    );

    const formFieldsJSX = formFields.map(field => {
      if (field.isEnum && field.enumValues) {
        const options = field.enumValues.map(val => 
          `          <option value="${val}">${val}</option>`
        ).join('\n');
        
        return `        <div>
          <Label htmlFor="${field.name}">${toPascalCase(field.name)}</Label>
          <Select {...form.register("${field.name}")}>
            <option value="">Select ${toPascalCase(field.name)}</option>
${options}
          </Select>
        </div>`;
      } else if (field.type === 'boolean') {
        return `        <div>
          <Label htmlFor="${field.name}">${toPascalCase(field.name)}</Label>
          <Switch {...form.register("${field.name}")} />
        </div>`;
      } else if (field.type === 'text') {
        return `        <div>
          <Label htmlFor="${field.name}">${toPascalCase(field.name)}</Label>
          <Textarea {...form.register("${field.name}")} />
        </div>`;
      } else {
        return `        <div>
          <Label htmlFor="${field.name}">${toPascalCase(field.name)}</Label>
          <Input {...form.register("${field.name}")} />
        </div>`;
      }
    }).join('\n');

    return `import { useRouteModal } from "../../../components/modal/use-route-modal";
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal";
import { Button, Input, Label, Switch, Textarea, toast } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { useCreate${singularPascal} } from "../../../../hooks/api/${toKebabCase(model.pluralName)}";

type Create${singularPascal}Form = {
${formFields.map(f => `  ${f.name}: ${f.type === 'boolean' ? 'boolean' : 'string'};`).join('\n')}
};

const Create${singularPascal}Page = () => {
  const { handleSuccess } = useRouteModal();
  const { mutateAsync: create${singularPascal}, isPending } = useCreate${singularPascal}();

  const form = useForm<Create${singularPascal}Form>({
    defaultValues: {
${formFields.map(f => `      ${f.name}: ${f.type === 'boolean' ? 'false' : f.defaultValue ? `"${f.defaultValue}"` : '""'},`).join('\n')}
    },
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      await create${singularPascal}(data);
      toast.success("${singularPascal} created successfully");
      handleSuccess(\`${routePrefix}\`);
    } catch (error) {
      toast.error("Failed to create ${singularCamel}");
    }
  });

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteFocusModal.Close>
          <Button
            size="small"
            type="submit"
            isLoading={isPending}
            onClick={handleSubmit}
          >
            Create
          </Button>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-col gap-y-8">
        <div className="flex flex-col gap-y-4">
          <h1 className="text-xl font-medium">Create ${singularPascal}</h1>
          <p className="text-ui-fg-subtle">
            Create a new ${singularCamel} in your system.
          </p>
        </div>
        <div className="flex flex-col gap-y-4">
${formFieldsJSX}
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  );
};

export default Create${singularPascal}Page;
`;
  }

  private async generateEditRoute(model: ModelStructure, routePath: string) {
    const routeDir = routePath 
      ? path.join(this.adminRoutesDir, routePath)
      : path.join(this.adminRoutesDir, toKebabCase(model.pluralName));
    
    const editDir = path.join(routeDir, "[id]", "edit");
    await fs.mkdir(editDir, { recursive: true });
    
    const editContent = this.generateEditContent(model, routePath);
    await fs.writeFile(path.join(editDir, "page.tsx"), editContent);
    
    console.log(`✏️ Generated edit route at ${editDir}`);
  }

  private generateEditContent(model: ModelStructure, routePath: string): string {
    const singularPascal = toPascalCase(model.name);
    const pluralPascal = toPascalCase(model.pluralName);
    const singularCamel = toCamelCase(model.name);
    
    const routePrefix = routePath ? `/${routePath}` : `/${toKebabCase(model.pluralName)}`;
    
    // Generate form fields for non-system fields
    const formFields = model.fields.filter(f => 
      !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name)
    );

    // Generate field configurations for DynamicForm
    const fieldConfigs = formFields.map(field => {
      if (field.isEnum && field.enumValues) {
        const options = field.enumValues.map(val => 
          `    { value: "${val}", label: "${val}" }`
        ).join(',\n');
        
        return `    {
      name: "${field.name}",
      type: "select",
      label: "${toPascalCase(field.name)}",
      options: [
${options}
      ],
    },`;
      } else if (field.type === 'boolean') {
        return `    {
      name: "${field.name}",
      type: "switch",
      label: "${toPascalCase(field.name)}",
    },`;
      } else if (field.type === 'text') {
        return `    {
      name: "${field.name}",
      type: "text",
      label: "${toPascalCase(field.name)}",
    },`;
      } else if (field.type === 'dateTime') {
        return `    {
      name: "${field.name}",
      type: "date",
      label: "${toPascalCase(field.name)}",
    },`;
      } else {
        return `    {
      name: "${field.name}",
      type: "text",
      label: "${toPascalCase(field.name)}",
      ${field.name === 'name' ? 'required: true,' : ''}
    },`;
      }
    }).join('\n');

    return `import { toast } from "sonner";
import { DynamicForm, type FieldConfig } from "../../../../../components/common/dynamic-form";
import { useRouteModal } from "../../../../../components/modal/use-route-modal";
import { use${singularPascal}, useUpdate${singularPascal}, Admin${singularPascal} } from "../../../../../hooks/api/${toKebabCase(model.pluralName)}";
import { useParams } from "react-router-dom";

type ${singularPascal}FormData = {
${formFields.map(f => `  ${f.name}: ${f.type === 'boolean' ? 'boolean' : f.type === 'number' ? 'number' : 'string'};`).join('\n')}
};

type Edit${singularPascal}FormProps = {
  ${singularCamel}: Admin${singularPascal};
};

export const Edit${singularPascal}Form = ({ ${singularCamel} }: Edit${singularPascal}FormProps) => {
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdate${singularPascal}(${singularCamel}.id);

  const handleSubmit = async (data: ${singularPascal}FormData) => {
    await mutateAsync(
      data,
      {
        onSuccess: ({ ${singularCamel}: updated${singularPascal} }) => {
          toast.success(
            \`\${updated${singularPascal}.name || '${singularPascal}'} updated successfully\`
          );
          handleSuccess();
        },
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  };

  const fields: FieldConfig<${singularPascal}FormData>[] = [
${fieldConfigs}
  ];

  return (
    <DynamicForm<${singularPascal}FormData>
      fields={fields}
      defaultValues={{
${formFields.map(f => `        ${f.name}: ${singularCamel}.${f.name} ${f.type === 'boolean' ? '|| false' : f.type === 'number' ? '|| 0' : '|| ""'},`).join('\n')}
      }}
      onSubmit={handleSubmit}
      layout={{
        showDrawer: true,
        gridCols: 1,
      }}
    />
  );
};

const Edit${singularPascal}Page = () => {
  const { id } = useParams<{ id: string }>();
  const { ${singularCamel}, isLoading } = use${singularPascal}(id!);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!${singularCamel}) {
    return <div>Not found</div>;
  }

  return <Edit${singularPascal}Form ${singularCamel}={${singularCamel}} />;
};

export default Edit${singularPascal}Page;
`;
  }
}

// CLI execution
const showHelp = (exitCode = 0) => {
  console.log(`
Usage: npx medusa exec ./src/scripts/generate-ui.ts <modelName> [routePath] [--help | -h]

This script generates admin UI components with Data Tables, filters, search functionality, and CRUD routes based on model definitions.

Arguments:
  modelName     The name of the model to generate UI for (required)
  routePath     Optional route path (e.g., "settings/email-templates")
                If not provided, uses model name as route

Examples:
  npx medusa exec ./src/scripts/generate-ui.ts emailtemplates
  npx medusa exec ./src/scripts/generate-ui.ts emailtemplates settings/email-templates
  npx medusa exec ./src/scripts/generate-ui.ts designs

Generated Components:
  - Data Table page with search and filters
  - Column definitions hook
  - Create route with form
  - Edit route with form

The script will automatically:
  - Analyze model fields and detect searchable/filterable properties
  - Generate appropriate filters for enums and boolean fields
  - Create form fields based on field types
  - Follow existing UI patterns from task-templates
`);
  process.exit(exitCode);
};

const run = async ({ args }: { args: string[] }) => {
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  const positionalArgs = args.filter(arg => !arg.startsWith('--'));

  if (positionalArgs.length < 1) {
    console.error("Error: Missing required argument: modelName.");
    showHelp(1);
    return;
  }

  const [modelName, routePath = ''] = positionalArgs;

  if (!modelName) {
    console.error("Error: modelName must be provided.");
    showHelp(1);
    return;
  }

  try {
    const generator = new UIGenerator();
    await generator.generate(modelName, routePath);
  } catch (error) {
    console.error(`Error during UI generation: ${error.message}`);
    throw error;
  }
};

export default run;
export { UIGenerator };
