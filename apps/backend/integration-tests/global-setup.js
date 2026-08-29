// Global setup for shared test environment
console.log('Setting up shared test environment...');

/**
 * Where the embedded CRM store lives for this run (#1551/#1552).
 *
 * ⚠️ Chosen HERE rather than in setup.js because globalSetup and globalTeardown
 * share a process, and setup.js runs in each worker. A path computed in the
 * worker is invisible to teardown, so the directory was never cleaned up.
 */
const crmStore = require('node:path').join(
  require('node:os').tmpdir(),
  `jyt-crm-store-${process.pid}`
);
process.env.CRM_HYPERBEE_STORE = process.env.CRM_HYPERBEE_STORE || crmStore;

module.exports = async () => {
  // This runs once before all tests
  // We can initialize any global resources here if needed
  console.log('Global setup complete');
};

module.exports.crmStore = crmStore;
