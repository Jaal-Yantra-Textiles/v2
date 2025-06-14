import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const IS_INTERACTIVE = require.main === module;

// --- Helper Functions ---
const toPascalCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

const showHelp = () => {
  console.log(`
Usage: npx ts-node src/scripts/generate-model.ts <module_name> <model_name> [field:type]...

Generates a new data model within a specified module.

Arguments:
  module_name   The name of the module to add the model to (e.g., 'products').
  model_name    The name of the new model (e.g., 'review').
  [field:type]  (Optional) A list of fields and their types.

Supported Types: id, text, string, integer, boolean, json, datetime, date, time, float, bignumber, amount, enum

For 'enum' type, provide values like: status:enum(active,inactive,archived)
`);
  process.exit(0);
};

const typeToModelMap: Record<string, { type: string; options?: any }> = {
  id: { type: 'id' }, // Typically handled by default, but good to have
  string: { type: 'text' }, // 'string' is a common alias for 'text'
  text: { type: 'text' },
  integer: { type: 'integer' },
  boolean: { type: 'boolean' },
  json: { type: 'json' },
  datetime: { type: 'dateTime' },
  date: { type: 'date' },
  time: { type: 'time' },
  float: { type: 'float' },
  bignumber: { type: 'bigNumber' },
  amount: { type: 'bigNumber', options: { isAmount: true } }, // Special case
  enum: { type: 'enum' }, // Requires values
};

// --- Template Generation ---

const getModelTemplate = (modelName: string, fields: string[]) => {
  const pascalCaseName = toPascalCase(modelName);
  let fieldsString = '  id: model.id().primaryKey(),\n';

  fields.forEach(field => {
    const [name, typeAndValues = 'text'] = field.split(':');
    const typeMatch = typeAndValues.match(/^(\w+)(?:\((.+)\))?$/);
    if (!typeMatch) {
      fieldsString += `  ${name}: model.text(), // Default or invalid format
`;
      return;
    }

    const typeKey = typeMatch[1].toLowerCase();
    const valuesString = typeMatch[2]; 

    const modelMapping = typeToModelMap[typeKey];
    if (!modelMapping) {
      fieldsString += `  ${name}: model.text(), // Unknown type, defaulting to text
`;
      return;
    }

    let fieldDefinition = `  ${name}: model.${modelMapping.type}(`;
    if (modelMapping.type === 'enum') {
      if (valuesString) {
        const enumValues = valuesString.split(',').map(v => v.trim());
        fieldDefinition += `${JSON.stringify(enumValues)}`;
      } else {
        fieldDefinition += `['value1', 'value2']`; // Default enum values
      }
    }
    fieldDefinition += `)`;

    if (modelMapping.options) {
      fieldDefinition += `.options(${JSON.stringify(modelMapping.options)})`;
    }
    fieldsString += `${fieldDefinition},\n`;
  });

  return `import { model } from "@medusajs/framework/utils";

const ${pascalCaseName} = model.define("${modelName}", {
${fieldsString}});

export default ${pascalCaseName};
`;
};

// --- File System Logic ---

const updateModuleService = (moduleName: string, modelName: string) => {
  const servicePath = path.join(__dirname, '..', 'modules', moduleName, 'service.ts');
  const pascalCaseModel = toPascalCase(modelName);

  try {
    if (!fs.existsSync(servicePath)) return;

    let content = fs.readFileSync(servicePath, 'utf-8');
    
    // Add import statement
    const importStatement = `import ${pascalCaseModel} from "./models/${modelName}";\n`;
    content = importStatement + content;

    // Add to MedusaService constructor
    const serviceRegex = /extends MedusaService\({/;
    content = content.replace(serviceRegex, `extends MedusaService({\n  ${pascalCaseModel},`);

    fs.writeFileSync(servicePath, content);
    console.log(`Updated service: ${servicePath}`);
  } catch (e) {
    console.error(`Failed to update service file for module ${moduleName}:`, e);
  }
};

const generateModel = (moduleName: string, modelName: string, fields: string[]) => {
  if (!moduleName || !modelName) {
    console.error('Error: Module and model names are required.');
    showHelp();
  }

  console.log(`Generating model '${modelName}' in module '${moduleName}'...`);

  const modelDir = path.join(__dirname, '..', 'modules', moduleName, 'models');
  if (!fs.existsSync(modelDir)) {
    console.error(`Error: Module directory not found at ${modelDir}`);
    process.exit(1);
  }

  const modelPath = path.join(modelDir, `${modelName}.ts`);
  const template = getModelTemplate(modelName, fields);

  fs.writeFileSync(modelPath, template);
  console.log(`Created model: ${modelPath}`);

  updateModuleService(moduleName, modelName);
  
  console.log('\nModel generated successfully!');

  try {
    const projectRoot = path.join(__dirname, '..', '..'); // Assumes script is in src/scripts
    console.log(`\nGenerating migrations for module '${moduleName}'...`);
    execSync(`npx medusa db:generate ${moduleName}`, { stdio: 'inherit', cwd: projectRoot });
    
    console.log('\nApplying migrations...');
    execSync('npx medusa db:migrate', { stdio: 'inherit', cwd: projectRoot });
    
    console.log('\nMigrations completed successfully!');
  } catch (error) {
    console.error(`\nError during migration process: ${error.message}`);
    console.error('Please try running the migration commands manually:');
    console.error(`  npx medusa db:generate ${moduleName}`);
    console.error('  npx medusa db:migrate');
  }
};

// --- Entry Points ---

const run = async (args: string[]) => {
  if (args.includes('--help') || args.includes('-h') || args.length < 2) {
    showHelp();
    return;
  }

  const [moduleName, modelName, ...fields] = args;
  generateModel(moduleName, modelName, fields);
};

export default async ({ args }: { args: string[] }) => {
  await run(args);
};

if (IS_INTERACTIVE) {
  run(process.argv.slice(2));
}
