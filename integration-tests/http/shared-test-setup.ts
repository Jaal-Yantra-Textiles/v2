import { medusaIntegrationTestRunner } from "@medusajs/test-utils";

// Shared test environment instance
let sharedApi: any = null;
let sharedGetContainer: any = null;

/**
 * Shared test environment setup
 * This must be called synchronously at the top level of test files
 */
export function setupSharedTestSuite(testSuite: (env: { api: any; getContainer: any }) => void) {
  return medusaIntegrationTestRunner({
    testSuite: ({ api, getContainer }) => {
      // Store the environment for reuse
      sharedApi = api;
      sharedGetContainer = getContainer;
      
      // Run the test suite
      testSuite({ api, getContainer });
    }
  });
}

/**
 * Gets the shared test environment
 * This should only be called after setupSharedTestSuite has been called
 */
export function getSharedTestEnv() {
  if (!sharedApi || !sharedGetContainer) {
    throw new Error("Shared test environment not initialized. Make sure setupSharedTestSuite was called first.");
  }
  return { api: sharedApi, getContainer: sharedGetContainer };
}
