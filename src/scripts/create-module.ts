import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const IS_INTERACTIVE = require.main === module;

// --- Helper Functions ---
const toPascalCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
const toSnakeUpperCase = (str: string) => str.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase();

const showHelp = () => {
  console.log(`
Usage: npx medusa exec ./src/scripts/create-module.ts [moduleName] [--help | -h]

This script bootstraps a new Medusa module with a standard structure.

Arguments:
  moduleName    (Optional) The name of the module to create (e.g., 'product').
                If not provided, the script will prompt for it interactively.

Options:
  --help, -h    Show this help message.
  `);
  process.exit(0);
};

// --- Boilerplate Templates ---

const getIndexTemplate = (moduleName: string) => {
  const pascalCaseName = toPascalCase(moduleName);
  const snakeCaseName = toSnakeUpperCase(moduleName);
  return `import { Module } from "@medusajs/framework/utils";
import ${pascalCaseName}Service from "./service";

export const ${snakeCaseName}_MODULE = "${moduleName}";

const ${pascalCaseName}Module = Module(${snakeCaseName}_MODULE, {
  service: ${pascalCaseName}Service,
});

export default ${pascalCaseName}Module;
`;
};

const getServiceTemplate = (moduleName: string) => {
  const pascalCaseName = toPascalCase(moduleName);
  return `import { MedusaService } from "@medusajs/framework/utils";
// Import your models here, e.g.:
// import MyModel from "./models/MyModel";

class ${pascalCaseName}Service extends MedusaService({
  // Register your models here, e.g.:
  // MyModel,
}) {
  constructor() {
    super(...arguments)
  }
}

export default ${pascalCaseName}Service;
`;
};

const getModelTemplate = (moduleName: string) => {
  const pascalCaseName = toPascalCase(moduleName);
  return `import { model } from "@medusajs/framework/utils";

const ${pascalCaseName} = model.define("${moduleName}", {
  id: model.id().primaryKey(),
  // TODO: Add model properties here
  // Example:
  // name: model.text().searchable(),
});

export default ${pascalCaseName};
`;
};

// --- Main Script Logic ---

const addModuleToConfig = (moduleName: string) => {
  const configPaths = [
    path.join(__dirname, '..', '..', 'medusa-config.ts'),
    path.join(__dirname, '..', '..', 'medusa-config.prod.ts'),
  ];

  configPaths.forEach(configPath => {
    try {
      if (!fs.existsSync(configPath)) return;

      let content = fs.readFileSync(configPath, 'utf-8');
      const newModuleString = `  {\n    resolve: "./src/modules/${moduleName}",\n  },\n`;

      const modulesRegex = /modules:\s*\[/;
      const match = content.match(modulesRegex);

      if (!match || typeof match.index === 'undefined') {
        console.warn(`Could not find 'modules: [' in ${path.basename(configPath)}.`);
        return;
      }

      let bracketCount = 1;
      let endIndex = -1;
      for (let i = match.index + match[0].length; i < content.length; i++) {
        if (content[i] === '[') bracketCount++;
        if (content[i] === ']') bracketCount--;
        if (bracketCount === 0) {
          endIndex = i;
          break;
        }
      }

      if (endIndex === -1) {
        console.warn(`Could not find closing bracket for modules array in ${path.basename(configPath)}.`);
        return;
      }

      content = content.slice(0, endIndex) + newModuleString + content.slice(endIndex);
      fs.writeFileSync(configPath, content);
      console.log(`Added module '${moduleName}' to ${path.basename(configPath)}`);

    } catch (e) {
      console.error(`Failed to add module to ${path.basename(configPath)}:`, e);
    }
  });
};

const createModule = (moduleName: string) => {
  if (!moduleName || !/^[a-z_]+$/.test(moduleName)) {
    console.error('Error: Module name must be provided and be in lowercase snake_case format (e.g., product_review).');
    process.exit(1);
  }

  console.log(`Creating new module: ${moduleName}...`);

  const moduleDir = path.join(__dirname, '..', 'modules', moduleName);
  const modelsDir = path.join(moduleDir, 'models');

  // Create directories
  [moduleDir, modelsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    } else {
      console.log(`Directory already exists: ${dir}`);
    }
  });

  // File paths
  const indexPath = path.join(moduleDir, 'index.ts');
  const servicePath = path.join(moduleDir, 'service.ts');
  const modelPath = path.join(modelsDir, `${moduleName}.ts`);

  // Create files
  fs.writeFileSync(indexPath, getIndexTemplate(moduleName));
  console.log(`Created file: ${indexPath}`);
  fs.writeFileSync(servicePath, getServiceTemplate(moduleName));
  console.log(`Created file: ${servicePath}`);

  console.log(`\nModule '${moduleName}' created successfully!`);

  addModuleToConfig(moduleName);

  console.log('\nNext steps:');
  console.log(`1. Use the 'generate-model.ts' script to add models to 'src/modules/${moduleName}/models/'.`);
  console.log('2. After adding models, migrations will be handled automatically by the script.');
};

const run = async (args: string[]) => {
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  const moduleName = args.find(arg => !arg.startsWith('--'));

  if (moduleName) {
    createModule(moduleName);
  } else if (IS_INTERACTIVE) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>((resolve) => {
      rl.question('Please enter the name for the new module (e.g., product_review): ', (name) => {
        createModule(name);
        rl.close();
        resolve();
      });
    });
  } else {
    console.error('\nError: Module name is required when running in non-interactive mode.');
    console.error('Usage: npx medusa exec ./src/scripts/create-module.ts <module_name>\n');
    process.exit(1);
  }
};

// Entry point for `medusa exec`
export default async ({ args }: { args: string[] }) => {
  await run(args);
};

// Entry point for direct execution with `ts-node`
if (IS_INTERACTIVE) {
  run(process.argv.slice(2));
}

