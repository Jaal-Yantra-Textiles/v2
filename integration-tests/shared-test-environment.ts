import { medusaIntegrationTestRunner } from "@medusajs/test-utils";

// Shared test environment instance
let sharedTestEnv: any = null;
let testEnvPromise: Promise<any> | null = null;

/**
 * Gets a shared medusaIntegrationTestRunner instance
 * This helps reduce memory usage by reusing the same test environment
 * across multiple test files instead of creating a new one for each file
 */
export async function getSharedTestEnvironment() {
  if (sharedTestEnv) {
    return sharedTestEnv;
  }
  
  if (testEnvPromise) {
    return testEnvPromise;
  }
  
  // Create a new test environment
  testEnvPromise = new Promise((resolve) => {
    medusaIntegrationTestRunner({
      testSuite: ({ api, getContainer }) => {
        // Store the environment for reuse
        sharedTestEnv = { api, getContainer };
        resolve(sharedTestEnv);
      }
    });
  });
  
  return testEnvPromise;
}

/**
 * Resets the shared test environment
 * Call this between test suites to ensure clean state
 */
export function resetSharedTestEnvironment() {
  sharedTestEnv = null;
  testEnvPromise = null;
}
