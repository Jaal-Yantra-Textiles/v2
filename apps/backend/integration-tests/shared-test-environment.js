const { medusaIntegrationTestRunner } = require("@medusajs/test-utils");

// Shared test environment instance
let sharedTestEnv = null;
let testEnvPromise = null;

/**
 * Gets a shared medusaIntegrationTestRunner instance
 * This helps reduce memory usage by reusing the same test environment
 * across multiple test files instead of creating a new one for each file
 */
async function getSharedTestEnvironment() {
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
function resetSharedTestEnvironment() {
  sharedTestEnv = null;
  testEnvPromise = null;
}

module.exports = {
  getSharedTestEnvironment,
  resetSharedTestEnvironment
};
