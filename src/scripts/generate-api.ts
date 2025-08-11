import fs from "fs";
import path from "path";

// Helper functions for naming conventions
// Convert snake/kebab/mixed to PascalCase, keep Pascal if already
const toPascalCase = (str: string) => {
  if (/^[A-Z][A-Za-z0-9]*$/.test(str)) return str;
  return str
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
};

// Pluralization helpers consistent with MedusaService method generation
const pluralizePascal = (pascal: string) => (pascal.endsWith("s") ? pascal : `${pascal}s`);
const toLowerCamel = (pascal: string) => pascal.charAt(0).toLowerCase() + pascal.slice(1);
const toKebabCase = (str: string) =>
  str
    .replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/^-/, "");
const toSnakeCase = (str: string) => toKebabCase(str).replace(/-/g, "_");

// Resolve the actual model PascalCase identifier from the module's service.ts MedusaService config
const resolveModelPascalFromService = (moduleName: string, modelName: string): string => {
  try {
    const servicePath = path.join(process.cwd(), "src", "modules", moduleName, "service.ts");
    if (!fs.existsSync(servicePath)) return toPascalCase(modelName);
    const content = fs.readFileSync(servicePath, "utf-8");
    const match = content.match(/MedusaService\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    if (!match) return toPascalCase(modelName);
    const inside = match[1];
    const keys = Array.from(inside.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)).map((m) => m[1]);
    const normalizedInput = modelName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    for (const k of keys) {
      const normalizedKey = k.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      if (normalizedKey === normalizedInput) return k;
    }
    return toPascalCase(modelName);
  } catch {
    return toPascalCase(modelName);
  }
};

// --- Template for helpers.ts ---
const getHelpersTemplate = (pascalModel: string) => {
  const modelNameLower = pascalModel.toLowerCase();
  const snakeCaseModel = toSnakeCase(pascalModel);
  return `import { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// TODO: Update with actual model fields from your ${snakeCaseModel} entity
export type ${pascalModel}AllowedFields = string[];

export const refetch${pascalModel} = async (
  id: string,
  scope: MedusaContainer,
  fields: ${pascalModel}AllowedFields = ["*"]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: ${modelNameLower}s } = await query.graph({
    entity: "${snakeCaseModel}",
    filters: { id },
    fields,
  });

  if (!${modelNameLower}s?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      '${pascalModel} with id "' + id + '" not found'
    );
  }

  return ${modelNameLower}s[0];
};
`;
};

// --- Template for validators.ts ---
const getValidatorsTemplate = (pascalModel: string) => {
  return `import { z } from "zod";

// TODO: Define the Zod schema based on the ${pascalModel} model
export const ${pascalModel}Schema = z.object({
  id: z.string().optional(),
});

export type ${pascalModel} = z.infer<typeof ${pascalModel}Schema>;

// TODO: Define the Zod schema for updates
export const Update${pascalModel}Schema = z.object({
});

export type Update${pascalModel} = z.infer<typeof Update${pascalModel}Schema>;
`;
};

// --- Template for [id]/route.ts ---
const getIdRouteTemplate = (pascalModel: string, moduleName: string) => {
  const singularKey = toLowerCamel(pascalModel);
  // Workflows are generated with singular kebab filenames
  const kebabWorkflow = toKebabCase(pascalModel);

  return `import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Update${pascalModel} } from "../validators";
import { list${pascalModel}Workflow } from "../../../../workflows/${moduleName}/list-${kebabWorkflow}";
import { update${pascalModel}Workflow } from "../../../../workflows/${moduleName}/update-${kebabWorkflow}";
import { delete${pascalModel}Workflow } from "../../../../workflows/${moduleName}/delete-${kebabWorkflow}";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await list${pascalModel}Workflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ ${singularKey}: result[0][0] });
};

export const POST = async (req: MedusaRequest<Update${pascalModel}>, res: MedusaResponse) => {
  const { result } = await update${pascalModel}Workflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });
  res.status(200).json({ ${singularKey}: result });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await delete${pascalModel}Workflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "${singularKey}",
    deleted: true,
  });
};
`;
};

// --- Template for route.ts ---
const getRouteTemplate = (pascalModel: string, moduleName: string) => {
  const singularKey = toLowerCamel(pascalModel);
  const pluralKey = toLowerCamel(pluralizePascal(pascalModel));
  const kebabRoute = toKebabCase(pluralizePascal(pascalModel));

  return `import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ${pascalModel} } from "./validators";
import { create${pascalModel}Workflow } from "../../../workflows/${moduleName}/create-${kebabRoute}";
import { list${pascalModel}Workflow } from "../../../workflows/${moduleName}/list-${kebabRoute}";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  // TODO: Add query param parsing for filters, pagination, etc.
  const { result } = await list${pascalModel}Workflow(req.scope).run({
    input: {},
  });
  res.status(200).json({ ${pluralKey}: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<${pascalModel}>, res: MedusaResponse) => {
  const { result } = await create${pascalModel}Workflow(req.scope).run({
    input: req.validatedBody,
  });
  res.status(201).json({ ${singularKey}: result });
};
`;
};

// --- Main script logic ---
const runGeneratorLogic = async (scope: string, moduleName: string, modelName: string) => {

  // Resolve model from service.ts so API aligns with workflows and service naming
  const pascalModel = resolveModelPascalFromService(moduleName, modelName);

  console.log("Generating API for model '" + pascalModel + "'...");

  // Use pluralized kebab-case for route directory: e.g., payments, orders, payment-details
  const apiDir = path.join(process.cwd(), "src", "api", scope, toKebabCase(pluralizePascal(pascalModel)));
  const idDir = path.join(apiDir, "[id]");

  // Create directories
  fs.mkdirSync(idDir, { recursive: true });

  // Generate file content
  const routeContent = getRouteTemplate(pascalModel, moduleName);
  const idRouteContent = getIdRouteTemplate(pascalModel, moduleName);
  const validatorsContent = getValidatorsTemplate(pascalModel);
  const helpersContent = getHelpersTemplate(pascalModel);

  // Write files
  fs.writeFileSync(path.join(apiDir, "route.ts"), routeContent);
  fs.writeFileSync(path.join(idDir, "route.ts"), idRouteContent);
  fs.writeFileSync(path.join(apiDir, "validators.ts"), validatorsContent);
  fs.writeFileSync(path.join(apiDir, "helpers.ts"), helpersContent);

  console.log("Successfully created API files in " + apiDir);
};

const IS_INTERACTIVE = require.main === module;

const showHelp = (exitCode = 0) => {
  console.log(`
Usage: npx medusa exec ./src/scripts/generate-api.ts <scope> <moduleName> <modelName> [--help | -h]

This script generates API route handlers, validators, and helpers for a given model.

Arguments:
  scope         The API scope (e.g., 'admin', 'store').
  moduleName    The name of the module containing the model and potentially workflows (e.g., 'test_sample').
  modelName     The name of the model (e.g., 'TestItem').

Options:
  --help, -h    Show this help message.
  `);
  process.exit(exitCode);
};

const run = async ({ args }: { args: string[] }) => {
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  const positionalArgs = args.filter(arg => !arg.startsWith('--'));

  if (positionalArgs.length < 3) {
    console.error("Error: Missing required arguments: scope, moduleName, modelName.");
    showHelp(1);
    return; // Ensure exit or return
  }

  const [scope, moduleName, modelName] = positionalArgs;

  if (!scope || !moduleName || !modelName) {
    console.error("Error: Scope, moduleName, and modelName must be provided.");
    showHelp(1);
    return; // Ensure exit or return
  }

  try {
    await runGeneratorLogic(scope, moduleName, modelName);
  } catch (error) {
    console.error(`Error during API generation: ${error.message}`);
    // process.exit(1); // Avoid process.exit in medusa exec context if possible, let error propagate
    throw error; // Re-throw for medusa exec to handle
  }
};

export default run;

if (IS_INTERACTIVE) {
  // Simplified for direct execution, assumes args are passed directly
  const directArgs = process.argv.slice(2);
  run({ args: directArgs }).catch(err => {
    console.error("Failed to generate API:", err);
    process.exit(1);
  });
}