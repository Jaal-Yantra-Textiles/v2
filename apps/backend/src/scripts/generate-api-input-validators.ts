import fs from "fs/promises";
import path from "path";

// Helper functions for naming conventions
const toPascalCase = (str: string) =>
  str.replace(/(^\w|-\w)/g, (g) => g.replace(/-/, "").toUpperCase());
const toKebabCase = (str: string) =>
  str
    .replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/^-/, "");
const toSnakeCase = (str: string) => toKebabCase(str).replace(/-/g, "_");

// --- Enhanced Type Mapping ---
const mapModelTypeToZod = (modelType: string, fieldName: string): string => {
  // Handle text fields
  if (modelType.startsWith('model.text')) {
    // Email fields
    if (fieldName.includes('email') || fieldName === 'to' || fieldName === 'from' || fieldName === 'cc' || fieldName === 'bcc') {
      return 'z.string().email()';
    }
    // URL fields
    if (fieldName.includes('url') || fieldName.includes('link')) {
      return 'z.string().url()';
    }
    // Required text with minimum length
    if (modelType.includes('.searchable()') || fieldName === 'name' || fieldName === 'title' || fieldName === 'subject') {
      const capitalizedField = fieldName.charAt(0).toUpperCase() + fieldName.slice(1).replace(/_/g, ' ');
      return `z.string().min(1, "${capitalizedField} is required")`;
    }
    return 'z.string()';
  }

  // Handle date/time fields
  if (modelType.startsWith('model.dateTime')) {
    return 'z.coerce.date()';
  }

  // Handle JSON fields
  if (modelType.startsWith('model.json')) {
    return 'z.record(z.unknown())';
  }

  // Handle boolean fields
  if (modelType.startsWith('model.boolean')) {
    const defaultMatch = modelType.match(/\.default\((.*?)\)/);
    if (defaultMatch) {
      return `z.boolean().default(${defaultMatch[1]})`;
    }
    return 'z.boolean()';
  }

  // Handle text fields with defaults
  if (modelType.startsWith('model.text') && modelType.includes('.default(')) {
    const defaultMatch = modelType.match(/\.default\((.*?)\)/);
    if (defaultMatch) {
      const defaultValue = defaultMatch[1];
      // Handle email fields with defaults
      if (fieldName.includes('email') || fieldName === 'to' || fieldName === 'from' || fieldName === 'cc' || fieldName === 'bcc') {
        return `z.string().email().default(${defaultValue})`;
      }
      return `z.string().default(${defaultValue})`;
    }
  }

  // Handle enum fields
  if (modelType.startsWith('model.enum')) {
    const arrayMatch = modelType.match(/\(\[(.*?)\]\)/);
    if (arrayMatch && arrayMatch[1]) {
      const defaultMatch = modelType.match(/\.default\("(.*?)"\)/);
      const enumDef = `z.enum([${arrayMatch[1]}])`;
      return defaultMatch ? `${enumDef}.default("${defaultMatch[1]}")` : enumDef;
    }
    return 'z.string()';
  }

  // Handle ID fields
  if (modelType.startsWith('model.id')) {
    return 'z.string()';
  }

  // Handle numeric fields
  if (modelType.startsWith('model.number') || modelType.startsWith('model.integer')) {
    return 'z.number()';
  }

  // Handle foreign key relationships
  if (modelType.startsWith('model.belongsTo') || modelType.startsWith('model.hasMany')) {
    return 'z.string()'; // Foreign keys are strings
  }

  // Default fallback
  return 'z.string()';
};

// --- Enhanced Model Parser ---
const parseModelFields = (content: string) => {
  const fields: { [key: string]: { zodType: string; isOptional: boolean; hasDefault: boolean; defaultValue?: string } } = {};
  
  // Updated regex to handle MedusaJS v2 syntax: model.define("table_name", { ... })
  const modelDefinitionRegex = /model\.define\(\s*["']\w+["']\s*,\s*\{([\s\S]*?)\}\s*\)/m;
  const match = content.match(modelDefinitionRegex);

  if (!match || !match[1]) {
    console.log('Model content preview:', content.substring(0, 200));
    throw new Error('Could not find model.define block or its properties. Expected format: model.define("table_name", { ... })');
  }

  const propertiesBlock = match[1];
  const fieldRegex = /^\s*(\w+):\s*(model\..*?),?$/gm;
  let fieldMatch;

  while ((fieldMatch = fieldRegex.exec(propertiesBlock)) !== null) {
    let [_, fieldName, modelChain] = fieldMatch;

    // Skip id field as it's auto-generated
    if (fieldName === 'id') continue;

    const isOptional = modelChain.includes('.nullable()');
    const hasDefault = modelChain.includes('.default(');
    let defaultValue: string | undefined;

    // Extract default value
    const defaultMatch = modelChain.match(/\.default\((.*?)\)/);
    if (defaultMatch) {
      defaultValue = defaultMatch[1];
    }

    // Handle relationships
    if (modelChain.startsWith('model.belongsTo')) {
      fieldName = `${fieldName}_id`;
      modelChain = 'model.text()'; // Foreign keys are strings
    }

    // Skip hasMany relationships for input validation
    if (modelChain.startsWith('model.hasMany')) {
      continue;
    }

    const zodType = mapModelTypeToZod(modelChain, fieldName);
    fields[fieldName] = { zodType, isOptional, hasDefault, defaultValue };
  }

  return fields;
};

// --- Enhanced Schema Generator ---
const generateZodSchemaContent = (
  modelName: string,
  fields: { [key: string]: { zodType: string; isOptional: boolean; hasDefault: boolean; defaultValue?: string } }
): string => {
  const pascalModel = toPascalCase(modelName);
  const snakeModel = toSnakeCase(modelName);

  // Generate base schema fields
  const baseSchemaFields = Object.entries(fields)
    .map(([name, { zodType, isOptional }]) => {
      const optionalSuffix = isOptional ? '.nullable().optional()' : '';
      return `  ${name}: ${zodType}${optionalSuffix},`;
    })
    .join('\n');

  // Generate create schema fields (exclude timestamps)
  const createSchemaFields = Object.entries(fields)
    .filter(([name]) => !['created_at', 'updated_at', 'deleted_at'].includes(name))
    .map(([name, { zodType, isOptional, hasDefault }]) => {
      let fieldDef = zodType;
      if (isOptional && !hasDefault) {
        fieldDef += '.nullable().optional()';
      } else if (isOptional) {
        fieldDef += '.optional()';
      }
      return `  ${name}: ${fieldDef},`;
    })
    .join('\n');

  // Generate update schema fields (all optional except id)
  const updateSchemaFields = Object.entries(fields)
    .filter(([name]) => !['created_at', 'updated_at', 'deleted_at'].includes(name))
    .map(([name, { zodType }]) => {
      const baseType = zodType.replace(/\.default\(.*?\)/, '');
      return `  ${name}: ${baseType}.optional(),`;
    })
    .join('\n');

  return `import { z } from "@medusajs/framework/zod";

// Base ${pascalModel} schema
export const ${pascalModel}Schema = z.object({
  id: z.string().optional(),
${baseSchemaFields}
  created_at: z.coerce.date().optional(),
  updated_at: z.coerce.date().optional(),
});

export type ${pascalModel} = z.infer<typeof ${pascalModel}Schema>;

// Create ${pascalModel} schema (excludes id, timestamps)
export const Create${pascalModel}Schema = ${pascalModel}Schema.omit({
  id: true,
  created_at: true,
  updated_at: true,
}).strict();

export type Create${pascalModel} = z.infer<typeof Create${pascalModel}Schema>;

// Update ${pascalModel} schema (all fields optional except id)
export const Update${pascalModel}Schema = ${pascalModel}Schema.omit({
  created_at: true,
  updated_at: true,
}).partial().extend({
  id: z.string().optional(),
}).strict();

export type Update${pascalModel} = z.infer<typeof Update${pascalModel}Schema>;

// Query parameters schema with preprocessing
export const ${pascalModel}QueryParams = z.object({
  limit: z.preprocess(
    (val) => (typeof val === "string" ? parseInt(val, 10) : val),
    z.number().min(1).max(100).default(20)
  ),
  offset: z.preprocess(
    (val) => (typeof val === "string" ? parseInt(val, 10) : val),
    z.number().min(0).default(0)
  ),
  order: z.string().optional(),
  fields: z.preprocess(
    (val) => (typeof val === "string" ? val.split(",") : val),
    z.array(z.string()).optional()
  ),
  search: z.string().optional(),
  // Add specific filter fields based on model
${Object.entries(fields)
  .filter(([name, { zodType }]) => 
    zodType.includes('z.enum') || 
    zodType.includes('z.boolean') || 
    name.includes('key') || 
    name.includes('type') ||
    name.includes('status')
  )
  .map(([name, { zodType }]) => {
    if (zodType.includes('z.boolean')) {
      return `  ${name}: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        return val.toLowerCase() === "true";
      }
      return val;
    },
    z.boolean().optional()
  ),`;
    }
    return `  ${name}: z.string().optional(),`;
  })
  .join('\n')}
});

export type ${pascalModel}QueryParams = z.infer<typeof ${pascalModel}QueryParams>;

// Schema for bulk operations
export const Bulk${pascalModel}Schema = z.object({
  ids: z.array(z.string().min(1)).min(1, "At least one ID is required"),
});

export type Bulk${pascalModel} = z.infer<typeof Bulk${pascalModel}Schema>;


`;
};

// --- Enhanced Model Path Discovery ---
const findModelFile = async (moduleName: string, modelName: string): Promise<string> => {
  const kebabModelName = toKebabCase(modelName);
  const snakeModelName = toSnakeCase(modelName);
  const lowerModelName = modelName.toLowerCase();
  
  // Generate all possible file names
  const possibleFileNames = [
    `${modelName}.ts`,
    `${kebabModelName}.ts`, 
    `${snakeModelName}.ts`,
    `${lowerModelName}.ts`,
    // Plural versions
    `${modelName}s.ts`,
    `${kebabModelName}s.ts`,
    `${snakeModelName}s.ts`,
    `${lowerModelName}s.ts`,
  ];

  // Generate all possible directory structures
  const possibleDirStructures = [
    ['src', 'modules', moduleName, 'models'],
    ['src', 'modules', moduleName, 'model'], // singular
    ['src', 'modules', toKebabCase(moduleName), 'models'],
    ['src', 'modules', toKebabCase(moduleName), 'model'],
    ['src', 'modules', toSnakeCase(moduleName), 'models'],
    ['src', 'modules', toSnakeCase(moduleName), 'model'],
    // Alternative structures
    ['src', 'modules', moduleName],
    ['src', 'modules', toKebabCase(moduleName)],
    ['src', 'modules', toSnakeCase(moduleName)],
  ];

  console.log(`Searching for model file '${modelName}' in module '${moduleName}'...`);
  
  // Try all combinations
  for (const dirStructure of possibleDirStructures) {
    for (const fileName of possibleFileNames) {
      const possiblePath = path.join(process.cwd(), ...dirStructure, fileName);
      try {
        await fs.access(possiblePath);
        console.log(`Found model file at: ${possiblePath}`);
        return possiblePath;
      } catch {
        // File doesn't exist, continue searching
      }
    }
  }

  // If not found, try recursive search in the module directory
  const moduleDir = path.join(process.cwd(), 'src', 'modules', moduleName);
  try {
    await fs.access(moduleDir);
    const foundPath = await recursiveModelSearch(moduleDir, possibleFileNames);
    if (foundPath) {
      console.log(`Found model file via recursive search at: ${foundPath}`);
      return foundPath;
    }
  } catch {
    // Module directory doesn't exist
  }

  // Try alternative module naming
  const altModuleDir = path.join(process.cwd(), 'src', 'modules', toKebabCase(moduleName));
  try {
    await fs.access(altModuleDir);
    const foundPath = await recursiveModelSearch(altModuleDir, possibleFileNames);
    if (foundPath) {
      console.log(`Found model file via recursive search in kebab-case module at: ${foundPath}`);
      return foundPath;
    }
  } catch {
    // Alternative module directory doesn't exist
  }

  throw new Error(`Could not find model file for '${modelName}' in module '${moduleName}'. Searched in multiple directory structures and naming conventions.`);
};

// Recursive search function
const recursiveModelSearch = async (dir: string, fileNames: string[]): Promise<string | null> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    // First, check files in current directory
    for (const entry of entries) {
      if (entry.isFile() && fileNames.includes(entry.name)) {
        return path.join(dir, entry.name);
      }
    }
    
    // Then, recursively search subdirectories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDirPath = path.join(dir, entry.name);
        const found = await recursiveModelSearch(subDirPath, fileNames);
        if (found) {
          return found;
        }
      }
    }
  } catch {
    // Directory access error, skip
  }
  
  return null;
};

// --- Main Execution Logic ---
const runGeneratorLogic = async (moduleName: string, modelName: string) => {
  const kebabModelName = toKebabCase(modelName);

  console.log(`Generating comprehensive validators for model '${modelName}'...`);

  // Find the model file using enhanced discovery
  const modelPath = await findModelFile(moduleName, modelName);

  const validatorPath = path.join(process.cwd(), 'src', 'api', 'admin', kebabModelName, 'validators.ts');

  console.log(`Reading model from: ${modelPath}`);
  console.log(`Writing validators to: ${validatorPath}`);

  const modelContent = await fs.readFile(modelPath, 'utf-8');
  const fields = parseModelFields(modelContent);
  const validatorContent = generateZodSchemaContent(modelName, fields);

  const validatorDir = path.dirname(validatorPath);
  await fs.mkdir(validatorDir, { recursive: true });
  await fs.writeFile(validatorPath, validatorContent);

  console.log(`Successfully generated comprehensive validators for ${modelName} at ${validatorPath}`);
  console.log(`Generated schemas: ${toPascalCase(modelName)}Schema, Create${toPascalCase(modelName)}Schema, Update${toPascalCase(modelName)}Schema, ${toPascalCase(modelName)}QueryParams, Bulk${toPascalCase(modelName)}Schema`);
};

// --- CLI Interface ---
const showHelp = (exitCode = 0) => {
  console.log(`
Usage: npx medusa exec ./src/scripts/generate-api-input-validators.ts <moduleName> <modelName> [--help | -h]

This script generates comprehensive Zod validators for API input validation based on model definitions.

Arguments:
  moduleName    The name of the module containing the model (e.g., 'email_templates').
  modelName     The name of the model (e.g., 'EmailTemplate').

Generated Schemas:
  - BaseSchema: Complete model schema with all fields
  - CreateSchema: For POST requests (excludes id, timestamps)
  - UpdateSchema: For PUT/PATCH requests (all fields optional)
  - QueryParams: For GET requests with preprocessing
  - BulkSchema: For bulk operations

Options:
  --help, -h    Show this help message.

Examples:
  npx medusa exec ./src/scripts/generate-api-input-validators.ts email_templates EmailTemplate
  npx medusa exec ./src/scripts/generate-api-input-validators.ts agreements Agreement
  `);
  process.exit(exitCode);
};

const run = async ({ args }: { args: string[] }) => {
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  const positionalArgs = args.filter(arg => !arg.startsWith('--'));

  if (positionalArgs.length < 2) {
    console.error("Error: Missing required arguments: moduleName, modelName.");
    showHelp(1);
    return;
  }

  const [moduleName, modelName] = positionalArgs;

  if (!moduleName || !modelName) {
    console.error("Error: moduleName and modelName must be provided.");
    showHelp(1);
    return;
  }

  try {
    await runGeneratorLogic(moduleName, modelName);
  } catch (error) {
    console.error(`Error during validator generation: ${error.message}`);
    throw error;
  }
};

export default run;

const IS_INTERACTIVE = require.main === module;

if (IS_INTERACTIVE) {
  const directArgs = process.argv.slice(2);
  run({ args: directArgs }).catch(err => {
    console.error("Failed to generate validators:", err);
    process.exit(1);
  });
}
