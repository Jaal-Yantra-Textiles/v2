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
  
  // Add more memory
  testTimeout: 60000,
  
  // Add setup file for shared environment
  setupFilesAfterEnv: [
    "<rootDir>/setup.js"
  ],
  
  // Global setup and teardown for shared environment
  globalSetup: "<rootDir>/global-setup.js",
  globalTeardown: "<rootDir>/global-teardown.js",
};
