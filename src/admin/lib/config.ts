/// <reference types="vite/types/importMeta.d.ts" />
import Medusa from "@medusajs/js-sdk";

// Vite uses import.meta.env instead of process.env for environment variables
// Variables must be prefixed with VITE_ to be exposed to the client
export const sdk = new Medusa({
  baseUrl: import.meta.env.VITE_MEDUSA_BACKEND_URL || "http://localhost:9000",
  debug: import.meta.env.MODE === "development",
  auth: {
    type: "session",
  },
});
