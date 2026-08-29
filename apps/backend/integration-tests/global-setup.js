// Global setup for shared test environment
console.log('Setting up shared test environment...');

/**
 * The embedded CRM store is IN MEMORY, one per worker process (#1648) — set in
 * setup.js, which runs in each worker. Nothing is written to disk, so there is
 * no path for globalTeardown to clean up any more.
 */
process.env.CRM_HYPERBEE_STORE = process.env.CRM_HYPERBEE_STORE || ":memory:";

module.exports = async () => {
  // This runs once before all tests
  // We can initialize any global resources here if needed
  console.log('Global setup complete');
};
