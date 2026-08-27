module.exports = {
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.spec.ts"],
  transform: {
    "^.+\\.[jt]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
          target: "es2021",
        },
        module: { type: "commonjs" },
      },
    ],
  },
  testEnvironment: "node",
}
