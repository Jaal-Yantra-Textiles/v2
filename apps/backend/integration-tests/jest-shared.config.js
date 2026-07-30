module.exports = {
  // Inherit from the main jest config but override setupFiles
  ...require('../jest.config'),
  setupFiles: ["<rootDir>/setup.js"],
  
  // Override test match to run all http tests together
  testMatch: [
    "**/integration-tests/http/**/*.spec.ts"
  ],
  
  // Run tests sequentially to use shared environment
  maxWorkers: 1,
  
  // Floor for every http spec. The shared runner's beforeAll boots a full
  // Medusa app, which takes 25-50s on a cold CI database — so any file-level
  // `jest.setTimeout()` below this is a downgrade that fails on CI and passes
  // locally against a warm shared DB. That is exactly how the 30s files (and
  // one 10s file) died: on the boot hook, before asserting anything.
  //
  // Prefer inheriting this over redeclaring per file. Raise it in a single
  // spec only when that spec is genuinely long-running.
  testTimeout: 90000,
  
  // Add setup file for shared environment
  setupFilesAfterEnv: [
    "<rootDir>/setup.js"
  ],
  
  // Global setup and teardown for shared environment
  globalSetup: "<rootDir>/global-setup.js",
  globalTeardown: "<rootDir>/global-teardown.js",
};
