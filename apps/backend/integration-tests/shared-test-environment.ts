import { medusaIntegrationTestRunner } from "@medusajs/test-utils";

// Shared test environment instance
let sharedTestEnv: any = null;
let testEnvPromise: Promise<any> | null = null;
let testFileCount = 0;
const MAX_TESTS_PER_ENVIRONMENT = 10;

/**
 * Gets a shared medusaIntegrationTestRunner instance
 * This helps reduce memory usage by reusing the same test environment
 * across multiple test files instead of creating a new one for each file
 */
export async function getSharedTestEnvironment() {
  // Reset environment periodically to prevent memory leaks
  if (testFileCount >= MAX_TESTS_PER_ENVIRONMENT) {
    console.log(`Resetting shared test environment after ${testFileCount} test files`);
    resetSharedTestEnvironment();
    testFileCount = 0;
    
    // Force garbage collection if available
    if (global.gc) {
      console.log('Forcing garbage collection...');
      global.gc();
    }
  }
  
  testFileCount++;
  
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
  testFileCount = 0;
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
}
