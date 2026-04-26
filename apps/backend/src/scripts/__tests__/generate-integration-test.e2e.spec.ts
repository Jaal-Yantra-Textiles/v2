import fs from 'fs/promises';
import path from 'path';
import { runCLI } from '@jest/core'; // For programmatically running Jest
import generateIntegrationTest from '../generate-integration-test'; // The script we are testing

// Define paths
const projectRootPath = process.cwd();
const moduleDir = path.join(projectRootPath, 'src', 'modules', 'test-sample');
const modelDir = path.join(moduleDir, 'models');
const modelFilePath = path.join(modelDir, 'TestItem.ts');
const apiDir = path.join(projectRootPath, 'src', 'api', 'admin', 'test-item');
const apiIdDir = path.join(apiDir, '[id]');
const apiRouteFilePath = path.join(apiDir, 'route.ts');
const apiIdRouteFilePath = path.join(apiIdDir, 'route.ts');
const generatedTestPath = path.join(
  projectRootPath,
  'integration-tests/http/test-sample/test-item-api.spec.ts'
);

const dummyModelContent = `
import { model } from "@medusajs/framework/utils";

const TestItem = model.define("test_item", {
  id: model.id().primaryKey(),
  name: model.text(),
  quantity: model.integer().nullable(),
  status: model.enum(['active', 'inactive']).default('active'),
});

export default TestItem;
`;

const dummyApiRouteContent = `
import { MedusaRequest, MedusaResponse } from "@medusajs/medusa";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json({ test_items: [], count: 0, offset: 0, limit: 10 });
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { name, quantity, status } = req.body as any;
  // In a real scenario, you'd use a service to create the item
  res.status(201).json({ test_item: { id: "test-id-gen" + Date.now(), name, quantity, status, created_at: new Date(), updated_at: new Date() } });
}
`;

const dummyApiIdRouteContent = `
import { MedusaRequest, MedusaResponse } from "@medusajs/medusa";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { id } = req.params;
  res.json({ test_item: { id, name: "Test Item Name", quantity: 1, status: "active", created_at: new Date(), updated_at: new Date() } });
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { id } = req.params;
  const { name, quantity, status } = req.body as any;
  // In a real scenario, you'd use a service to update the item
  res.json({ test_item: { id, name, quantity, status, updated_at: new Date() } });
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { id } = req.params;
  // In a real scenario, you'd use a service to delete the item
  res.json({ id, object: "test_item", deleted: true });
}
`;

describe('generate-integration-test E2E', () => {
  beforeEach(async () => {
    // Ensure model directory exists
    await fs.mkdir(modelDir, { recursive: true });
    // Create dummy model file
    await fs.writeFile(modelFilePath, dummyModelContent);

    // Ensure API directories exist
    await fs.mkdir(apiIdDir, { recursive: true }); // Creates apiDir and apiIdDir
    // Create dummy API route files
    await fs.writeFile(apiRouteFilePath, dummyApiRouteContent);
    await fs.writeFile(apiIdRouteFilePath, dummyApiIdRouteContent);

    // Delete previously generated test file if it exists
    try {
      // await fs.unlink(generatedTestPath); // Temporarily commented out for debugging
    } catch (error: any) {
      if (error.code !== 'ENOENT') { // Ignore if file doesn't exist
        throw error;
      }
    }
  });

  afterAll(async () => {
    // Clean up the generated test file
    try {
      // await fs.unlink(generatedTestPath); // Temporarily commented out for debugging
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        // console.warn(`Could not clean up ${generatedTestPath}: ${error.message}`);
      }
    }
    // Clean up the dummy model file
    try {
      await fs.unlink(modelFilePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        // console.warn(`Could not clean up ${modelFilePath}: ${error.message}`);
      }
    }
    // Clean up dummy API files and directories
    try {
      await fs.unlink(apiRouteFilePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') { /* console.warn(`Could not clean up ${apiRouteFilePath}: ${error.message}`); */ }
    }
    try {
      await fs.unlink(apiIdRouteFilePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') { /* console.warn(`Could not clean up ${apiIdRouteFilePath}: ${error.message}`); */ }
    }
    try {
      await fs.rmdir(apiIdDir);
    } catch (error: any) { /* Ignore */ }
    try {
      await fs.rmdir(apiDir);
    } catch (error: any) { /* Ignore */ }
    // Attempt to remove model directories if empty - best effort
    try {
      await fs.rmdir(modelDir);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        // console.warn(`Could not clean up ${modelFilePath}: ${error.message}`);
      }
    }
    // Attempt to remove directories if empty - best effort, might fail if other files exist
    try {
      // await fs.rmdir(modelDir); // Already attempted above
      await fs.rmdir(moduleDir);
    } catch (error: any) {
      // Ignore errors here, directory might not be empty or might not exist
    }
  });

  it('should generate a valid and passing integration test for the TestItem module', async () => {
    // 1. Run the generator script for the "TestSample" module and "TestItem" model
    console.log('E2E Test: Running generator for TestItem...');
    // Assuming 'test-sample' is the module name (kebab-case) and 'TestItem' is the model name (PascalCase)
    await expect(generateIntegrationTest({ args: ['test-sample', 'TestItem'] })).resolves.not.toThrow();

    // 2. Verify the test file was created
    console.log(`E2E Test: Checking for generated file at ${generatedTestPath}...`);
    await expect(fs.access(generatedTestPath)).resolves.not.toThrow();

    // 3. Run the newly generated test file using Jest's programmatic API
    console.log('E2E Test: Running the generated TestItem integration test...');
    
    // Set TEST_TYPE for Medusa's test environment setup
    const originalTestType = process.env.TEST_TYPE;
    process.env.TEST_TYPE = 'integration:http';

    const { results } = await runCLI(
      {
        roots: [projectRootPath],
        silent: false, // Disable silent mode to see output from the generated test
        verbose: true, // Add verbosity
        testPathPattern: [generatedTestPath],
        runInBand: true,
        // If your main jest command uses specific config for integration tests (like TEST_TYPE env var),
        // you might need to replicate that environment here or ensure your jest.config.js handles it.
      } as any, 
      [projectRootPath]
    );

    // Restore original TEST_TYPE if it was set
    if (originalTestType) {
      process.env.TEST_TYPE = originalTestType;
    } else {
      delete process.env.TEST_TYPE;
    }

    console.log('E2E Test: Generated test run completed. Results summary:', { 
      success: results.success,
      numTotalTests: results.numTotalTests,
      numPassedTests: results.numPassedTests,
      numFailedTests: results.numFailedTests,
      // snapshot: results.snapshot // if you want more details
    });

    // 4. Assert that the generated test suite passed
    expect(results.numTotalTests).toBeGreaterThan(0);
    expect(results.numFailedTests).toBe(0);
    expect(results.numPassedTests).toBe(results.numTotalTests);

  }, 90000); // Increased timeout for E2E test (generator + running another jest instance)
});
