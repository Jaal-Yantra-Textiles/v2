// Global teardown for shared test environment
const { resetSharedTestEnvironment } = require('./shared-test-environment');

console.log('Tearing down shared test environment...');

module.exports = async () => {
  // This runs once after all tests
  // Clean up any global resources
  resetSharedTestEnvironment();

  // The embedded CRM store is a DIRECTORY under the temp dir, one per run
  // (setup.js keys it on the pid). Postgres is reset by the runner; this is not,
  // so without this it accumulates a corestore per local run forever.
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
