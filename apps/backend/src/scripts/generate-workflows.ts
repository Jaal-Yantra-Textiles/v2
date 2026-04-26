import * as fs from 'fs';
import * as path from 'path';

// --- Helper Functions ---
// Convert a string like "payment_details" or "payment-details" to "PaymentDetails"
const toPascalCaseWords = (str: string) =>
  str
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

// Backwards compatibility: if already PascalCase, keep it
const toPascalCase = (str: string) => {
  if (/^[A-Z][A-Za-z0-9]*$/.test(str)) return str;
  return toPascalCaseWords(str);
};
const toKebabCase = (str: string) => str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();
const toSnakeUpperCase = (str: string) =>
  str.includes("_")
    ? str.replace(/-/g, "_").toUpperCase()
    : str.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();

const pluralizePascal = (pascal: string) => (pascal.endsWith('s') ? pascal : `${pascal}s`);

// Try to infer the actual model identifier from the module's service.ts MedusaService config
const resolveModelPascalFromService = (moduleName: string, modelName: string): string => {
  try {
    const servicePath = path.join(__dirname, '..', 'modules', moduleName, 'service.ts');
    if (!fs.existsSync(servicePath)) return toPascalCase(modelName);
    const content = fs.readFileSync(servicePath, 'utf-8');
    const match = content.match(/MedusaService\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    if (!match) return toPascalCase(modelName);
    const inside = match[1];
    const keys = Array.from(inside.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)).map((m) => m[1]);
    const normalizedInput = modelName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    // Find best match by normalization without underscores/case
    for (const k of keys) {
      const normalizedKey = k.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (normalizedKey === normalizedInput) return k;
    }
    return toPascalCase(modelName);
  } catch {
    return toPascalCase(modelName);
  }
};

const showHelp = (exitCode = 0, calledFromRun = false) => {
  console.log(`
Usage: npx ts-node src/scripts/generate-workflows.ts <module_name> <model_name>

Generates standard CRUD workflows for a given model.

Arguments:
  module_name   The name of the module (e.g., 'socials').
  model_name    The name of the model in PascalCase (e.g., 'SocialPlatform').
  `);
  if (!calledFromRun) process.exit(exitCode);
};

// --- Template Generation ---

const getCreateWorkflowTemplate = (moduleName: string, pascal: string) => {
  const kebab = toKebabCase(pascal);
  const moduleConst = toSnakeUpperCase(moduleName) + '_MODULE';
  const serviceName = `${pascal}Service`;
  const pluralPascal = pluralizePascal(pascal);

  return `import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ${moduleConst} } from "../../modules/${moduleName}";
import ${serviceName} from "../../modules/${moduleName}/service";

export type Create${pascal}StepInput = {
  // TODO: Define the properties for creating a ${pascal} from your model
  // Example: name: string;
};

export const create${pascal}Step = createStep(
  "create-${kebab}-step",
  async (input: Create${pascal}StepInput, { container }) => {
    const service: ${serviceName} = container.resolve(${moduleConst});
    const created = await service.create${pluralPascal}(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: ${serviceName} = container.resolve(${moduleConst});
    await service.softDelete${pluralPascal}(id);
  }
);

export type Create${pascal}WorkflowInput = Create${pascal}StepInput;

export const create${pascal}Workflow = createWorkflow(
  "create-${kebab}",
  (input: Create${pascal}WorkflowInput) => {
    const result = create${pascal}Step(input);
    return new WorkflowResponse(result);
  }
);
`
};

const getListWorkflowTemplate = (moduleName: string, pascal: string) => {
  const kebab = toKebabCase(pascal);
  const moduleConst = toSnakeUpperCase(moduleName) + '_MODULE';
  const serviceName = `${pascal}Service`;
  const pluralPascal = pluralizePascal(pascal);

  return `import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ${moduleConst} } from "../../modules/${moduleName}";
import ${serviceName} from "../../modules/${moduleName}/service";

export type List${pascal}StepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const list${pascal}Step = createStep(
  "list-${kebab}-step",
  async (input: List${pascal}StepInput, { container }) => {
    const service: ${serviceName} = container.resolve(${moduleConst});
    const results = await service.listAndCount${pluralPascal}(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type List${pascal}WorkflowInput = List${pascal}StepInput;

export const list${pascal}Workflow = createWorkflow(
  "list-${kebab}",
  (input: List${pascal}WorkflowInput) => {
    const results = list${pascal}Step(input);
    return new WorkflowResponse(results);
  }
);
`
};

const getUpdateWorkflowTemplate = (moduleName: string, pascal: string) => {
  const kebab = toKebabCase(pascal);
  const moduleConst = toSnakeUpperCase(moduleName) + '_MODULE';
  const serviceName = `${pascal}Service`;
  const pluralPascal = pluralizePascal(pascal);

  return `import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ${moduleConst} } from "../../modules/${moduleName}";
import ${serviceName} from "../../modules/${moduleName}/service";

export type Update${pascal}StepInput = {
  id: string;
  // TODO: Define optional properties for updating a ${pascal} from your model
  // Example: name?: string;
};

export const update${pascal}Step = createStep(
  "update-${kebab}-step",
  async (input: Update${pascal}StepInput, { container }) => {
    const service: ${serviceName} = container.resolve(${moduleConst});
    const { id, ...updateData } = input;

    const original = await service.retrieve${pascal}(id);

    const updated = await service.update${pluralPascal}({ id, ...updateData });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: ${serviceName} = container.resolve(${moduleConst});
    await service.update${pluralPascal}({ id: compensationData.id, ...compensationData.originalData });
  }
);

export type Update${pascal}WorkflowInput = Update${pascal}StepInput;

export const update${pascal}Workflow = createWorkflow(
  "update-${kebab}",
  (input: Update${pascal}WorkflowInput) => {
    const result = update${pascal}Step(input);
    return new WorkflowResponse(result);
  }
);
`
};

const getDeleteWorkflowTemplate = (moduleName: string, pascal: string) => {
  const kebab = toKebabCase(pascal);
  const moduleConst = toSnakeUpperCase(moduleName) + '_MODULE';
  const serviceName = `${pascal}Service`;
  const pluralPascal = pluralizePascal(pascal);

  return `import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ${moduleConst} } from "../../modules/${moduleName}";
import ${serviceName} from "../../modules/${moduleName}/service";

export type Delete${pascal}StepInput = {
  id: string;
};

export const delete${pascal}Step = createStep(
  "delete-${kebab}-step",
  async (input: Delete${pascal}StepInput, { container }) => {
    const service: ${serviceName} = container.resolve(${moduleConst});
    const original = await service.retrieve${pascal}(input.id);

    await service.delete${pluralPascal}(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: ${serviceName} = container.resolve(${moduleConst});
    await service.create${pluralPascal}(original);
  }
);

export type Delete${pascal}WorkflowInput = Delete${pascal}StepInput;

export const delete${pascal}Workflow = createWorkflow(
  "delete-${kebab}",
  (input: Delete${pascal}WorkflowInput) => {
    const result = delete${pascal}Step(input);
    return new WorkflowResponse(result);
  }
);
`
};

// --- Main Logic ---

const runGeneratorLogic = async (moduleName: string, modelName: string): Promise<void> => {
  console.log(`Generating workflows for model '${modelName}' in module '${moduleName}'...`);

  const workflowDir = path.join(__dirname, '..', 'workflows', moduleName);
  if (!fs.existsSync(workflowDir)) {
    fs.mkdirSync(workflowDir, { recursive: true });
    console.log(`Created directory: ${workflowDir}`);
  }

  // Resolve the real PascalCase model identifier from service.ts if possible
  const pascalModelName = resolveModelPascalFromService(moduleName, modelName);
  const kebabModelName = toKebabCase(pascalModelName);

  const filesToCreate = {
    [`create-${kebabModelName}.ts`]: getCreateWorkflowTemplate(moduleName, pascalModelName),
    [`list-${kebabModelName}.ts`]: getListWorkflowTemplate(moduleName, pascalModelName),
    [`update-${kebabModelName}.ts`]: getUpdateWorkflowTemplate(moduleName, pascalModelName),
    [`delete-${kebabModelName}.ts`]: getDeleteWorkflowTemplate(moduleName, pascalModelName),
  };

  for (const [fileName, content] of Object.entries(filesToCreate)) {
    const filePath = path.join(workflowDir, fileName);
    fs.writeFileSync(filePath, content);
    console.log(`Created workflow: ${filePath}`);
  }

  console.log('\nWorkflow generation complete!');
};

// --- Entry Point ---

const IS_INTERACTIVE = require.main === module;

const run = async ({ args }: { args: string[] }) => {
  if (args.includes('--help') || args.includes('-h')) {
    showHelp(0, true);
    return;
  }

  const positionalArgs = args.filter(arg => !arg.startsWith('--'));

  if (positionalArgs.length < 2) {
    console.error("Error: Missing required arguments: module_name, model_name.");
    showHelp(1, true);
    return; // Ensure exit or return
  }

  const [moduleName, modelName] = positionalArgs;

  if (!moduleName || !modelName) {
    console.error("Error: module_name and model_name must be provided.");
    showHelp(1, true);
    return; // Ensure exit or return
  }

  try {
    await runGeneratorLogic(moduleName, modelName);
  } catch (error) {
    console.error(`Error during workflow generation: ${error.message}`);
    // process.exit(1); // Avoid process.exit in medusa exec context if possible
    throw error; // Re-throw for medusa exec to handle
  }
};

export default run;

if (IS_INTERACTIVE) {
  // Simplified for direct execution, assumes args are passed directly
  const directArgs = process.argv.slice(2);
  run({ args: directArgs }).catch(err => {
    console.error("Failed to generate workflows:", err);
    process.exit(1);
  });
}
