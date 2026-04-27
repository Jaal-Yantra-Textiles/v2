const { loadEnv } = require("@medusajs/utils");
loadEnv("test", process.cwd());

module.exports = {
  setupFiles: ["./integration-tests/setup.js"],
  transform: {
    // TypeScript / JSX / classic JS — same swc preset as before.
    "^.+\\.[jt]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true, decorators: true },
          target: "es5",
        },
      },
    ],
    // ESM-only transitive deps (tokenx via @mastra/core) ship `.mjs`
    // files. The typescript parser above rejects an ESM body so .mjs
    // needs its own entry. target=es5 forces CJS output so Jest's
    // CommonJS runtime can require() it without "Must use import to
    // load ES Module".
    "^.+\\.mjs$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "ecmascript" },
          target: "es5",
        },
      },
    ],
  },
  // Default ignore is "/node_modules/" — too broad for ESM transitives.
  // The pattern below matches `node_modules/` only when the rest of the
  // path does NOT contain "tokenx", letting tokenx (the @mastra/core
  // transitive that triggered the original "Must use import to load ES
  // Module" failure) reach the .mjs transform above. Add other ESM-only
  // transitives by extending the negative lookahead — keep tight; broad
  // patterns slow every test run because more files get transformed.
  transformIgnorePatterns: [
    "node_modules/(?!.*tokenx)",
    "\\.pnp\\.[^\\/]+$",
  ],
  testEnvironment: "node",
  moduleFileExtensions: ["js", "mjs", "ts", "tsx", "jsx", "json"],
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  forceExit: true,
};

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/**/*.spec.[jt]s"];
} else if (process.env.TEST_TYPE === "integration:modules") {
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.[jt]s"];
} else if (process.env.TEST_TYPE === "unit") {
  module.exports.testMatch = ["**/src/**/__tests__/**/*.unit.spec.[jt]s"];
}