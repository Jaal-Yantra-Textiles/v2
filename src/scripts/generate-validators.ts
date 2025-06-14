import { promises as fs } from 'fs';
import path from 'path';

// --- Helper Functions ---
const toKebabCase = (str: string) =>
  str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();

const toPascalCase = (str: string) =>
  str.replace(/(^\w|-\w)/g, (c) => c.replace('-', '').toUpperCase());

// --- Type Mapping ---
const mapModelTypeToZod = (modelType: string): string => {
  if (modelType.startsWith('model.text')) return 'z.string()';
  if (modelType.startsWith('model.dateTime')) return 'z.coerce.date()';
  if (modelType.startsWith('model.json')) return 'z.record(z.unknown())';
  if (modelType.startsWith('model.enum')) {
    const arrayMatch = modelType.match(/\(\[(.*?)\]\)/);
    if (arrayMatch && arrayMatch[1]) {
      return `z.enum([${arrayMatch[1]}])`;
    }
    return 'z.any()'; // Fallback
  }
  return 'z.string()'; // Fallback for other types like id, foreign keys
};

// --- Model Parser ---
const parseModelFields = (content: string) => {
  const fields: { [key: string]: { zodType: string; isOptional: boolean } } = {};
  const modelDefinitionRegex = /model\.define\([\s\S]*?,\s*\{([\s\S]*?)}\);/m;
  const match = content.match(modelDefinitionRegex);

  if (!match || !match[1]) {
    throw new Error('Could not find model.define block or its properties.');
  }

  const propertiesBlock = match[1];
  const fieldRegex = /^\s*(\w+):\s*(model\..*?),?$/gm;
  let fieldMatch;

  while ((fieldMatch = fieldRegex.exec(propertiesBlock)) !== null) {
    let [_, fieldName, modelChain] = fieldMatch;

    if (fieldName === 'id') continue;

    const isOptional = modelChain.includes('.nullable()');

    if (modelChain.startsWith('model.belongsTo')) {
      fieldName = `${fieldName}_id`;
      modelChain = 'model.text()'; // Foreign keys are strings
    }

    const zodType = mapModelTypeToZod(modelChain);
    fields[fieldName] = { zodType, isOptional };
  }

  return fields;
};

// --- Schema Generator ---
const generateZodSchemaContent = (
  modelName: string,
  fields: { [key: string]: { zodType: string; isOptional: boolean } }
): string => {
  const pascalModel = toPascalCase(modelName);

  const createSchemaFields = Object.entries(fields)
    .map(([name, { zodType, isOptional }]) => `  ${name}: ${zodType}${isOptional ? '.optional()' : ''},`)
    .join('\n');

  const updateSchemaFields = Object.entries(fields)
    .map(([name, { zodType }]) => `  ${name}: ${zodType}.optional(),`)
    .join('\n');

  return `import { z } from "zod";

export const ${pascalModel}Schema = z.object({
${createSchemaFields}
});

export type ${pascalModel} = z.infer<typeof ${pascalModel}Schema>;

export const Update${pascalModel}Schema = z.object({
${updateSchemaFields}
});

export type Update${pascalModel} = z.infer<typeof Update${pascalModel}Schema>;
`;
};

// --- Main Execution ---
const main = async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: ts-node src/scripts/generate-validators.ts <module-name> <model-name>');
    process.exit(1);
  }

  const [moduleName, modelName] = args;
  const kebabModelName = toKebabCase(modelName);

  console.log(`Generating validators for model '${modelName}'...`);

  const modelPath = path.join(process.cwd(), 'src', 'modules', moduleName, 'models', `${modelName}.ts`);
  const validatorPath = path.join(process.cwd(), 'src', 'api', 'admin', kebabModelName, 'validators.ts');

  console.log(`Reading model from: ${modelPath}`);
  console.log(`Writing validators to: ${validatorPath}`);

  const modelContent = await fs.readFile(modelPath, 'utf-8');
  const fields = parseModelFields(modelContent);
  const validatorContent = generateZodSchemaContent(modelName, fields);

  const validatorDir = path.dirname(validatorPath);
  await fs.mkdir(validatorDir, { recursive: true });
  await fs.writeFile(validatorPath, validatorContent);

  console.log(`Successfully generated validators for ${modelName} at ${validatorPath}`);
};

main().catch((error) => {
  console.error('Error generating validators:', error);
  process.exit(1);
});
