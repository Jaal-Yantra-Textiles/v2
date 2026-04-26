import { getSharedTestEnvironment, resetSharedTestEnvironment } from "../../shared-test-environment";
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";

/**
 * A wrapper around medusaIntegrationTestRunner that uses a shared environment
 * This reduces memory usage by reusing the same Medusa app instance
 */
export function sharedMedusaIntegrationTestRunner({ testSuite }: { testSuite: (env: { api: any; getContainer: any }) => void }) {
  // We'll use a custom approach that works with the shared environment
  beforeAll(async () => {
    // Get the shared test environment
    const env = await getSharedTestEnvironment();
    
    // Make the environment available to tests
    (global as any).__SHARED_TEST_ENV__ = env;
  });
  
  // Run the test suite with the shared environment
  testSuite({
    get api() {
      return (global as any).__SHARED_TEST_ENV__?.api;
    },
    get getContainer() {
      return (global as any).__SHARED_TEST_ENV__?.getContainer;
    }
  });
  
  // Clean up after all tests in this suite
  afterAll(() => {
    // Note: We don't reset the shared environment here to allow reuse
    // Reset only happens when explicitly called
    delete (global as any).__SHARED_TEST_ENV__;
  });
}

/**
 * Helper function to set up admin user and auth headers in tests
 * using the shared environment
 */
export async function setupSharedTestEnvironment() {
  const env = await getSharedTestEnvironment();
  const container = env.getContainer();
  await createAdminUser(container);
  const headers = await getAuthHeaders(env.api);
  return { headers, api: env.api, getContainer: env.getContainer };
}

/**
 * Resets the shared test environment completely
 * Call this when you need a fresh environment
 */
export async function resetTestEnvironment() {
  resetSharedTestEnvironment();
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
}
