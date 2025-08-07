// Global teardown for shared test environment
const { resetSharedTestEnvironment } = require('./shared-test-environment');

console.log('Tearing down shared test environment...');

module.exports = async () => {
  // This runs once after all tests
  // Clean up any global resources
  resetSharedTestEnvironment();
  console.log('Global teardown complete');
};
