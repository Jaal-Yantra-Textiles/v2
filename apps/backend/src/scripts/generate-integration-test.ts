import fs from 'fs/promises';
import path from 'path';
import { toKebabCase, toPascalCase } from './utils/case-converters';
import { parseModel } from './utils/model-parser';
import { generateTestFileContent } from './utils/test-template';

const IS_INTERACTIVE = require.main === module;

// Export the core logic as a function for testing and internal use
export const runGenerator = async (moduleNameInput: string, modelNameInput: string): Promise<void> => {
  const moduleNameKebab = toKebabCase(moduleNameInput);
  const modelNamePascal = toPascalCase(modelNameInput);
  const modelNameKebab = toKebabCase(modelNameInput);

  console.log(`Generating integration test for model '${modelNamePascal}' in module '${moduleNameInput}'...`);

  const modelPath = path.join(process.cwd(), 'src', 'modules', moduleNameInput, 'models', `${modelNamePascal}.ts`); // Use moduleNameInput directly
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

    console.log(`[DEBUG] Content for ${testFilePath} generated. Length: ${content?.length ?? 'undefined'}`);
    if (typeof content !== 'string' || content.length === 0) {
        console.error(`[DEBUG] Content is empty or not a string. Aborting write for ${testFilePath}.`);
        // If empty content is an error, you might want to throw here:
        // throw new Error('Generated content is empty, cannot write test file.');
    } else {
        console.log(`[DEBUG] Attempting to write file: ${testFilePath}`);
        await fs.writeFile(testFilePath, content);
        console.log(`[DEBUG] fs.writeFile completed for: ${testFilePath}`);
    }

    console.log(`Successfully generated test for ${modelNamePascal} at: ${testFilePath}`);
    console.log('Dependencies found:', dependencies.map(d => d.pascal));
    console.log('Required fields found:', requiredFields.map(f => f.name));
  } catch (error) {
    console.error(`Error generating test for ${modelNamePascal}:`, error);
    throw error; // Rethrow to allow error handling by the caller (medusa exec or direct script run)
  }
};

// Main run function for argument parsing and calling core logic
const run = async (args: string[]): Promise<void> => {
  if (args.length < 2) {
    const usage = IS_INTERACTIVE
      ? 'Usage: ts-node src/scripts/generate-integration-test.ts <moduleName> <modelName>'
      : 'Usage via medusa exec: <moduleName> <modelName>';
    console.error(usage);
    // For medusa exec, throwing an error is preferred over process.exit
    if (IS_INTERACTIVE) process.exit(1);
    else throw new Error(usage);
    return; // Should not be reached if process.exit or throw occurs
  }
  const [moduleNameArg, modelNameArg] = args;
  await runGenerator(moduleNameArg, modelNameArg);
};

// Entry point for `medusa exec`
export default async ({ args }: { args: string[] }) => {
  try {
    await run(args);
  } catch (error) {
    // Medusa might have its own error handling, but rethrowing ensures it's not silent
    // console.error is already handled in runGeneratorLogic or run
    throw error;
  }
};

// Entry point for direct execution (e.g., ts-node)
if (IS_INTERACTIVE) {
  run(process.argv.slice(2)).catch(() => {
    // Error is already logged by runGeneratorLogic or run
    process.exit(1);
  });
}