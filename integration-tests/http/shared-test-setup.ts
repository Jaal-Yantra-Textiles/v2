import { AxiosError, AxiosInstance } from "axios"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";

// Shared test environment instance
let sharedApi: AxiosInstance | null = null;
let sharedGetContainer: any = null;

const attachHttpLogging = (api: AxiosInstance) => {
  if (!(api as any).__httpLoggingAttached && api?.interceptors?.response) {
    api.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const method = error.config?.method?.toUpperCase() ?? "UNKNOWN";
        const url = error.config?.url ?? "unknown-url";
        const status = error.response?.status ?? "NO_RESPONSE";
        const responseData = error.response?.data;
        const responseHeaders = error.response?.headers;
        console.error(
          `[HTTP ERROR] ${method} ${url} -> ${status}`,
          {
            responseData,
            responseHeaders,
          }
        );
        return Promise.reject(error);
      }
    );
    (api as any).__httpLoggingAttached = true;
  }
};

/**
 * Shared test environment setup
 * This must be called synchronously at the top level of test files
 */
export function setupSharedTestSuite(testSuite: (env: { api: AxiosInstance; getContainer: any }) => void) {
  return medusaIntegrationTestRunner({
    testSuite: ({ api, getContainer }) => {
      // Store the environment for reuse
      attachHttpLogging(api);
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

