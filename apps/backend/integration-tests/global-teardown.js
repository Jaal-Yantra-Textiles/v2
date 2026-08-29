// Global teardown for shared test environment
const { resetSharedTestEnvironment } = require('./shared-test-environment');

console.log('Tearing down shared test environment...');

module.exports = async () => {
  // This runs once after all tests
  // Clean up any global resources
  resetSharedTestEnvironment();

  // The CRM store is in memory now (#1648) and writes nothing. This sweep stays
  // only to clear the per-run directories older checkouts left behind; it is a
  // no-op on a machine that has only ever run the in-memory store.
  const os = require('node:os');
  const path = require('node:path');
  for (const name of require('node:fs').readdirSync(os.tmpdir())) {
    if (!name.startsWith('jyt-crm-store-')) continue;
    try {
      require('node:fs').rmSync(path.join(os.tmpdir(), name), {
        recursive: true,
        force: true,
      });
    } catch {
      // Tidiness only — never fail a green run over a leftover directory.
    }
  }

  console.log('Global teardown complete');
};
