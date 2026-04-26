#!/usr/bin/env node

/**
 * Admin API Hooks Generator
 * 
 * This script automatically generates admin API hook files in src/admin/hooks/api/
 * by analyzing the actual API route structure in src/api/admin/
 * 
 * Usage: npx medusa exec ./src/scripts/generate-admin-api-hooks.ts --resource=agreements
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

interface ApiRouteStructure {
  resourceName: string;
  pluralName: string;
  basePath: string;
  hasParentResource: boolean;
  parentResource?: string;
  parentPath?: string;
  hasNestedRoutes: boolean;
  nestedRoutes: string[];
  idDepth: number; // Number of ID parameters needed
  idParams: string[]; // List of ID parameter names
  urlPattern: {
    list: string;
    single: string;
    create: string;
    update: string;
    delete: string;
  };
}

class AdminApiHooksGenerator {
  private projectRoot: string;
  private hooksDir: string;
  private apiDir: string;

  constructor() {
    this.projectRoot = path.join(__dirname, "../..");
    this.hooksDir = path.join(this.projectRoot, "src/admin/hooks/api");
    this.apiDir = path.join(this.projectRoot, "src/api/admin");
  }

  async generate(resourceName: string) {
    console.log(`🔍 Analyzing API routes for ${resourceName}...`);

    const routeStructure = await this.analyzeApiRouteStructure(resourceName);
    if (!routeStructure) {
      console.error(`❌ Could not find API routes for ${resourceName}`);
      return;
    }

    console.log(`📋 Found route structure:`, {
      resourceName: routeStructure.resourceName,
      pluralName: routeStructure.pluralName,
      basePath: routeStructure.basePath,
      hasParentResource: routeStructure.hasParentResource,
      parentResource: routeStructure.parentResource,
      idDepth: routeStructure.idDepth,
      idParams: routeStructure.idParams,
    });

    // Ensure hooks directory exists
    await fs.mkdir(this.hooksDir, { recursive: true });

    // Generate the hook file
    const hookContent = this.generateHookContent(routeStructure);
    const hookFilePath = path.join(this.hooksDir, `${routeStructure.pluralName}.ts`);
    
    await fs.writeFile(hookFilePath, hookContent);

    console.log(`✅ Generated admin API hooks: ${hookFilePath}`);
    console.log(`📋 Generated hooks include:`);
    console.log(`   - use${toPascalCase(routeStructure.resourceName)} - Get single ${routeStructure.resourceName}`);
    console.log(`   - use${toPascalCase(routeStructure.pluralName)} - List ${routeStructure.pluralName}`);
    console.log(`   - useCreate${toPascalCase(routeStructure.pluralName)} - Create ${routeStructure.pluralName}`);
    console.log(`   - useUpdate${toPascalCase(routeStructure.resourceName)} - Update ${routeStructure.resourceName}`);
    console.log(`   - useDelete${toPascalCase(routeStructure.resourceName)} - Delete ${routeStructure.resourceName}`);
  }

  private async analyzeApiRouteStructure(resourceName: string): Promise<ApiRouteStructure | null> {
    // First, try to find the resource directly in /admin/
    const directPath = path.join(this.apiDir, resourceName);
    if (await this.pathExists(directPath)) {
      return await this.analyzeDirectRoute(resourceName, directPath);
    }

    // If not found directly, search for it as a nested resource
    return await this.findNestedResource(resourceName);
  }

  private async analyzeDirectRoute(resourceName: string, routePath: string): Promise<ApiRouteStructure> {
    const hasRouteFile = await this.pathExists(path.join(routePath, "route.ts"));
    const hasIdDir = await this.pathExists(path.join(routePath, "[id]"));
    const nestedRoutes = hasIdDir ? await this.getNestedRoutes(path.join(routePath, "[id]")) : [];

    // Keep original names for URLs and file paths
    const pluralName = resourceName;
    const singularName = toSingular(resourceName);
    
    // Create valid TypeScript identifiers
    const singularId = toCamelCase(singularName) + 'Id';

    return {
      resourceName: singularName,
      pluralName: pluralName,
      basePath: `/admin/${resourceName}`,
      hasParentResource: false,
      hasNestedRoutes: nestedRoutes.length > 0,
      nestedRoutes,
      idDepth: 1,
      idParams: [singularId],
      urlPattern: {
        list: `/admin/${resourceName}`,
        single: `/admin/${resourceName}/{${singularId}}`,
        create: `/admin/${resourceName}`,
        update: `/admin/${resourceName}/{${singularId}}`,
        delete: `/admin/${resourceName}/{${singularId}}`,
      },
    };
  }

  private async findNestedResource(resourceName: string): Promise<ApiRouteStructure | null> {
    // Search through all admin directories to find nested resources
    const adminDirs = await fs.readdir(this.apiDir);
    
    for (const dir of adminDirs) {
      const dirPath = path.join(this.apiDir, dir);
      const stats = await fs.stat(dirPath);
      
      if (stats.isDirectory()) {
        const idPath = path.join(dirPath, "[id]");
        if (await this.pathExists(idPath)) {
          const nestedDirs = await fs.readdir(idPath);
          
          if (nestedDirs.includes(resourceName)) {
            const resourcePath = path.join(idPath, resourceName);
            const hasRouteFile = await this.pathExists(path.join(resourcePath, "route.ts"));
            const hasIdDir = await this.pathExists(path.join(resourcePath, "[id]"));
            const nestedRoutes = hasIdDir ? await this.getNestedRoutes(path.join(resourcePath, "[id]")) : [];

            // Keep original names for URLs and file paths
            const pluralName = resourceName;
            const singularName = toSingular(resourceName);
            const parentSingular = toSingular(dir);
            
            // Create valid TypeScript identifiers
            const parentId = toCamelCase(parentSingular) + 'Id';
            const singularId = toCamelCase(singularName) + 'Id';

            return {
              resourceName: singularName,
              pluralName: pluralName,
              basePath: `/admin/${dir}/{${parentId}}/${resourceName}`,
              hasParentResource: true,
              parentResource: parentSingular,
              parentPath: `/admin/${dir}`,
              hasNestedRoutes: nestedRoutes.length > 0,
              nestedRoutes,
              idDepth: 2,
              idParams: [parentId, singularId],
              urlPattern: {
                list: `/admin/${dir}/{${parentId}}/${resourceName}`,
                single: `/admin/${dir}/{${parentId}}/${resourceName}/{${singularId}}`,
                create: `/admin/${dir}/{${parentId}}/${resourceName}`,
                update: `/admin/${dir}/{${parentId}}/${resourceName}/{${singularId}}`,
                delete: `/admin/${dir}/{${parentId}}/${resourceName}/{${singularId}}`,
              },
            };
          }
        }
      }
    }

    return null;
  }

  private async getNestedRoutes(idPath: string): Promise<string[]> {
    try {
      const items = await fs.readdir(idPath);
      const nestedRoutes: string[] = [];
      
      for (const item of items) {
        const itemPath = path.join(idPath, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory() && item !== "route.ts") {
          nestedRoutes.push(item);
        }
      }
      
      return nestedRoutes;
    } catch {
      return [];
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private generateHookContent(structure: ApiRouteStructure): string {
    const capitalizedModel = toPascalCase(structure.resourceName);
    const capitalizedPlural = toPascalCase(structure.pluralName);
    const camelModel = toCamelCase(structure.resourceName);
    const camelPlural = toCamelCase(structure.pluralName);
    
    // Generate imports
    const imports = this.generateImports(structure);
    
    // Generate type definitions
    const typeDefinitions = this.generateTypeDefinitions(capitalizedModel, camelModel, camelPlural);
    
    // Generate query keys
    const queryKeys = this.generateQueryKeys(structure);
    
    // Generate hooks
    const hooks = this.generateHooks(structure);

    return `${imports}

${typeDefinitions}

${queryKeys}

${hooks}`;
  }

  private generateImports(structure: ApiRouteStructure): string {
    let imports = `import { FetchError } from "@medusajs/js-sdk";
import { PaginatedResponse } from "@medusajs/types";
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";`;

    // Add parent resource import if needed
    if (structure.hasParentResource && structure.parentResource) {
      const parentPlural = structure.parentResource.endsWith('s') ? structure.parentResource : `${structure.parentResource}s`;
      imports += `\nimport { ${parentPlural}QueryKeys } from "./${parentPlural}";`;
    }

    return imports;
  }

  private generateTypeDefinitions(capitalizedModel: string, camelModel: string, camelPlural: string): string {
    return `export type Admin${capitalizedModel} = {
  id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date | null;
  [key: string]: any;
};

export type CreateAdmin${capitalizedModel}Payload = {
  [key: string]: any;
};

export type CreateAdmin${capitalizedModel}sPayload = {
  ${camelPlural}: CreateAdmin${capitalizedModel}Payload[];
};

export type Create${capitalizedModel}sPayload = CreateAdmin${capitalizedModel}Payload | CreateAdmin${capitalizedModel}sPayload;

export type UpdateAdmin${capitalizedModel}Payload = Partial<CreateAdmin${capitalizedModel}Payload>;

export interface Admin${capitalizedModel}Response {
  ${camelModel}: Admin${capitalizedModel};
}

export interface Admin${capitalizedModel}sResponse {
  ${camelPlural}: Admin${capitalizedModel}[];
  count: number;
  offset: number;
  limit: number;
}

export interface Admin${capitalizedModel}sQuery {
  q?: string;
  offset?: number;
  limit?: number;
  [key: string]: any;
}`;
  }

  private generateQueryKeys(structure: ApiRouteStructure): string {
    const capitalizedModel = toPascalCase(structure.resourceName);
    const camelPlural = toCamelCase(structure.pluralName);
    
    return `const ${capitalizedModel.toUpperCase()}_QUERY_KEY = "${structure.pluralName}" as const;
export const ${camelPlural}QueryKeys = queryKeysFactory(${capitalizedModel.toUpperCase()}_QUERY_KEY);`;
  }

  private generateHooks(structure: ApiRouteStructure): string {
    const capitalizedModel = toPascalCase(structure.resourceName);
    const capitalizedPlural = toPascalCase(structure.pluralName);
    
    const useSingleHook = this.generateUseSingleHook(structure, capitalizedModel);
    const useListHook = this.generateUseListHook(structure, capitalizedModel, capitalizedPlural);
    const useCreateHook = this.generateUseCreateHook(structure, capitalizedModel, capitalizedPlural);
    const useUpdateHook = this.generateUseUpdateHook(structure, capitalizedModel);
    const useDeleteHook = this.generateUseDeleteHook(structure, capitalizedModel);

    return `${useSingleHook}

${useListHook}

${useCreateHook}

${useUpdateHook}

${useDeleteHook}`;
  }

  private generateUseSingleHook(structure: ApiRouteStructure, capitalizedModel: string): string {
    const { resourceName, pluralName, idParams } = structure;
    const params = idParams.map(param => `${param}: string`).join(', ');
    const urlReplacements = idParams.map(param => `.replace('{${param}}', \`\${${param}}\`)`).join('');
    const camelPlural = toCamelCase(pluralName);
    
    return `export const use${capitalizedModel} = (
  ${params},
  options?: Omit<
    UseQueryOptions<Admin${capitalizedModel}Response, FetchError, Admin${capitalizedModel}Response, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: ${camelPlural}QueryKeys.detail(${idParams[idParams.length - 1]}),
    queryFn: async () =>
      sdk.client.fetch<Admin${capitalizedModel}Response>(
        \`${structure.urlPattern.single}\`${urlReplacements},
        {
          method: "GET",
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};`;
  }

  private generateUseListHook(structure: ApiRouteStructure, capitalizedModel: string, capitalizedPlural: string): string {
    const { pluralName, idParams } = structure;
    const listParams = idParams.slice(0, -1); // Remove the resource's own ID for list operations
    const params = listParams.length > 0 ? listParams.map(param => `${param}: string`).join(', ') + ', ' : '';
    const urlReplacements = listParams.map(param => `.replace('{${param}}', \`\${${param}}\`)`).join('');
    const queryKeyParams = listParams.length > 0 ? `{ ${listParams.join(', ')}, ...query }` : 'query';
    const camelPlural = toCamelCase(pluralName);
    
    return `export const use${capitalizedPlural} = (
  ${params}query?: Admin${capitalizedModel}sQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<Admin${capitalizedModel}sResponse>,
      FetchError,
      PaginatedResponse<Admin${capitalizedModel}sResponse>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: ${camelPlural}QueryKeys.list(${queryKeyParams}),
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<Admin${capitalizedModel}sResponse>>(
        \`${structure.urlPattern.list}\`${urlReplacements},
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  });
  return { ...data, ...rest };
};`;
  }

  private generateUseCreateHook(structure: ApiRouteStructure, capitalizedModel: string, capitalizedPlural: string): string {
    const { pluralName, idParams } = structure;
    const createParams = idParams.slice(0, -1); // Remove the resource's own ID for create operations
    const params = createParams.length > 0 ? createParams.map(param => `${param}: string`).join(', ') + ', ' : '';
    const urlReplacements = createParams.map(param => `.replace('{${param}}', \`\${${param}}\`)`).join('');
    const camelPlural = toCamelCase(pluralName);
    
    return `export const useCreate${capitalizedPlural} = (
  ${params}options?: UseMutationOptions<
    Admin${capitalizedModel}Response,
    FetchError,
    Create${capitalizedModel}sPayload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<Admin${capitalizedModel}Response>(
        \`${structure.urlPattern.create}\`${urlReplacements},
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: ${camelPlural}QueryKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};`;
  }

  private generateUseUpdateHook(structure: ApiRouteStructure, capitalizedModel: string): string {
    const { resourceName, pluralName, idParams } = structure;
    const params = idParams.map(param => `${param}: string`).join(', ');
    const urlReplacements = idParams.map(param => `.replace('{${param}}', \`\${${param}}\`)`).join('');
    const resourceId = idParams[idParams.length - 1];
    const camelPlural = toCamelCase(pluralName);
    
    return `export const useUpdate${capitalizedModel} = (
  ${params},
  options?: UseMutationOptions<
    Admin${capitalizedModel}Response,
    FetchError,
    UpdateAdmin${capitalizedModel}Payload
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<Admin${capitalizedModel}Response>(
        \`${structure.urlPattern.update}\`${urlReplacements},
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: ${camelPlural}QueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ${camelPlural}QueryKeys.detail(${resourceId}) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};`;
  }

  private generateUseDeleteHook(structure: ApiRouteStructure, capitalizedModel: string): string {
    const { resourceName, pluralName, idParams } = structure;
    const params = idParams.map(param => `${param}: string`).join(', ');
    const urlReplacements = idParams.map(param => `.replace('{${param}}', \`\${${param}}\`)`).join('');
    const resourceId = idParams[idParams.length - 1];
    const camelPlural = toCamelCase(pluralName);
    
    return `export const useDelete${capitalizedModel} = (
  ${params},
  options?: UseMutationOptions<Admin${capitalizedModel}, FetchError, void>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<Admin${capitalizedModel}>(
        \`${structure.urlPattern.delete}\`${urlReplacements},
        {
          method: "DELETE",
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: ${camelPlural}QueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ${camelPlural}QueryKeys.detail(${resourceId}) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};`;
  }


}

// CLI execution
const showHelp = (exitCode = 0) => {
  console.log(`
Usage: npx medusa exec ./src/scripts/generate-admin-api-hooks.ts <resourceName> [--help | -h]

This script generates admin API hook files by analyzing the actual API route structure.

Arguments:
  resourceName    The name of the resource (e.g., 'agreements', 'pages', 'categories').

Examples:
  npx medusa exec ./src/scripts/generate-admin-api-hooks.ts agreements
  npx medusa exec ./src/scripts/generate-admin-api-hooks.ts pages
  npx medusa exec ./src/scripts/generate-admin-api-hooks.ts categories

The script will automatically detect:
  - Whether it's a direct route (/admin/categories) or nested (/admin/persons/[id]/agreements)
  - The correct URL patterns and ID parameters
  - Parent resource relationships
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
    console.error("Error: Missing required argument: resourceName.");
    showHelp(1);
    return;
  }

  const [resourceName] = positionalArgs;

  if (!resourceName) {
    console.error("Error: resourceName must be provided.");
    showHelp(1);
    return;
  }

  try {
    const generator = new AdminApiHooksGenerator();
    await generator.generate(resourceName);
  } catch (error) {
    console.error(`Error during admin hooks generation: ${error.message}`);
    throw error;
  }
};

export default run;
export { AdminApiHooksGenerator };
