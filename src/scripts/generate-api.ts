import fs from "fs";
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
  const modelNameLower = pascalModel.toLowerCase();
  const kebabRoute = toKebabCase(pascalModel);

  return `import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Update${pascalModel} } from "../validators";
import { refetch${pascalModel} } from "../helpers";
import { list${pascalModel}Workflow } from "../../../../workflows/${moduleName}/list-${kebabRoute}";
import { update${pascalModel}Workflow } from "../../../../workflows/${moduleName}/update-${kebabRoute}";
import { delete${pascalModel}Workflow } from "../../../../workflows/${moduleName}/delete-${kebabRoute}";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await list${pascalModel}Workflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ ${modelNameLower}: result[0][0] });
};

export const POST = async (req: MedusaRequest<Update${pascalModel}>, res: MedusaResponse) => {
  const { result } = await update${pascalModel}Workflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });

  const ${modelNameLower} = await refetch${pascalModel}(result[0].id, req.scope);
  res.status(200).json({ ${modelNameLower} });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await delete${pascalModel}Workflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "${modelNameLower}",
    deleted: true,
  });
};
`;
};

// --- Template for route.ts ---
const getRouteTemplate = (pascalModel: string, moduleName: string) => {
  const modelNameLower = pascalModel.toLowerCase();
  const kebabRoute = toKebabCase(pascalModel);

  return `import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ${pascalModel} } from "./validators";
import { refetch${pascalModel} } from "./helpers";
import { create${pascalModel}Workflow } from "../../../workflows/${moduleName}/create-${kebabRoute}";
import { list${pascalModel}Workflow } from "../../../workflows/${moduleName}/list-${kebabRoute}";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  // TODO: Add query param parsing for filters, pagination, etc.
  const { result } = await list${pascalModel}Workflow(req.scope).run({
    input: {},
  });
  res.status(200).json({ ${modelNameLower}s: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<${pascalModel}>, res: MedusaResponse) => {
  const { result } = await create${pascalModel}Workflow(req.scope).run({
    input: req.validatedBody,
  });

  const ${modelNameLower} = await refetch${pascalModel}(result.id, req.scope);
  res.status(201).json({ ${modelNameLower} });
};
`;
};

// --- Main script logic ---
const runGeneratorLogic = async (scope: string, moduleName: string, modelName: string) => {

  const pascalModel = toPascalCase(modelName);

  console.log("Generating API for model '" + pascalModel + "'...");

  const apiDir = path.join(process.cwd(), "src", "api", scope, toKebabCase(modelName));
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