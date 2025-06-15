import fs from 'fs/promises';
import path from 'path';
import { toKebabCase, toPascalCase } from './utils/case-converters';
import { parseModel } from './utils/model-parser';
import { generateTestFileContent } from './utils/test-template';

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: ts-node src/scripts/generate-integration-test.ts <moduleName> <modelName>');
    process.exit(1);
  }

  const [moduleName, modelName] = args;

  const moduleNameKebab = toKebabCase(moduleName);
  const modelNamePascal = toPascalCase(modelName);
  const modelNameKebab = toKebabCase(modelName);

  console.log(`Generating integration test for model '${modelNamePascal}' in module '${moduleName}'...`);

  const modelPath = path.join(process.cwd(), 'src', 'modules', moduleNameKebab, 'models', `${modelNamePascal}.ts`);
  const testDir = path.join(process.cwd(), 'integration-tests', 'http', moduleNameKebab);
  const testFilePath = path.join(testDir, `${modelNameKebab}-api.spec.ts`);

  try {
    const { dependencies, requiredFields } = await parseModel(modelPath);
    await fs.mkdir(testDir, { recursive: true });
    
    const content = generateTestFileContent(
      modelNamePascal, 
      modelNameKebab, 
      dependencies, 
      requiredFields
    );

    await fs.writeFile(testFilePath, content);

    console.log(`Successfully generated test for ${modelNamePascal} at: ${testFilePath}`);
    console.log('Dependencies found:', dependencies.map(d => d.pascal));
    console.log('Required fields found:', requiredFields.map(f => f.name));
  } catch (error) {
    console.error(`Error generating test for ${modelNamePascal}:`, error);
    process.exit(1);
  }
};

main();