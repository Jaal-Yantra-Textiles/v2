import * as fs from 'fs';
import * as path from 'path';

// --- Helper Functions ---
const toPascalCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
const toKebabCase = (str: string) => str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase();
const toSnakeUpperCase = (str: string) => str.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase();

const showHelp = () => {
  console.log(`
Usage: npx ts-node src/scripts/generate-workflows.ts <module_name> <model_name>

Generates standard CRUD workflows for a given model.

Arguments:
  module_name   The name of the module (e.g., 'socials').
  model_name    The name of the model in PascalCase (e.g., 'SocialPlatform').
  `);
  process.exit(0);
};

// --- Template Generation ---

const getCreateWorkflowTemplate = (moduleName: string, modelName: string) => {
  const pascal = toPascalCase(modelName);
  const kebab = toKebabCase(modelName);
  const moduleConst = toSnakeUpperCase(moduleName) + '_MODULE';
  const serviceName = `${pascal}Service`;

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
    const created = await service.create${pascal}s(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: ${serviceName} = container.resolve(${moduleConst});
    await service.softDelete${pascal}s(id);
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

const getListWorkflowTemplate = (moduleName: string, modelName: string) => {
  const pascal = toPascalCase(modelName);
  const kebab = toKebabCase(modelName);
  const moduleConst = toSnakeUpperCase(moduleName) + '_MODULE';
  const serviceName = `${pascal}Service`;

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
    const results = await service.listAndCount${pascal}s(
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

const getUpdateWorkflowTemplate = (moduleName: string, modelName: string) => {
  const pascal = toPascalCase(modelName);
  const kebab = toKebabCase(modelName);
  const moduleConst = toSnakeUpperCase(moduleName) + '_MODULE';
  const serviceName = `${pascal}Service`;

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

    const updated = await service.update${pascal}s({
      selector: { id },
      data: updateData,
    });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: ${serviceName} = container.resolve(${moduleConst});
    await service.update${pascal}s({
      selector: { id: compensationData.id },
      data: compensationData.originalData,
    });
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

const getDeleteWorkflowTemplate = (moduleName: string, modelName: string) => {
  const pascal = toPascalCase(modelName);
  const kebab = toKebabCase(modelName);
  const moduleConst = toSnakeUpperCase(moduleName) + '_MODULE';
  const serviceName = `${pascal}Service`;

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

    await service.delete${pascal}s(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: ${serviceName} = container.resolve(${moduleConst});
    await service.create${pascal}s(original);
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

const generateWorkflows = (moduleName: string, modelName: string) => {
  console.log(`Generating workflows for model '${modelName}' in module '${moduleName}'...`);

  const workflowDir = path.join(__dirname, '..', 'workflows', moduleName);
  if (!fs.existsSync(workflowDir)) {
    fs.mkdirSync(workflowDir, { recursive: true });
    console.log(`Created directory: ${workflowDir}`);
  }

  const kebabModelName = toKebabCase(modelName);

  const filesToCreate = {
    [`create-${kebabModelName}.ts`]: getCreateWorkflowTemplate(moduleName, modelName),
    [`list-${kebabModelName}.ts`]: getListWorkflowTemplate(moduleName, modelName),
    [`update-${kebabModelName}.ts`]: getUpdateWorkflowTemplate(moduleName, modelName),
    [`delete-${kebabModelName}.ts`]: getDeleteWorkflowTemplate(moduleName, modelName),
  };

  for (const [fileName, content] of Object.entries(filesToCreate)) {
    const filePath = path.join(workflowDir, fileName);
    fs.writeFileSync(filePath, content);
    console.log(`Created workflow: ${filePath}`);
  }

  console.log('\nWorkflow generation complete!');
};

// --- Entry Point ---

const run = (args: string[]) => {
  if (args.includes('--help') || args.includes('-h') || args.length < 2) {
    showHelp();
    return;
  }

  const [moduleName, modelName] = args;
  generateWorkflows(moduleName, modelName);
};

run(process.argv.slice(2));
