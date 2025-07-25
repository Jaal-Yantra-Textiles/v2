
/// <reference types="vite/client" />
import Medusa from "@medusajs/js-sdk";

// Vite environment variables - must be prefixed with VITE_ to be exposed to client
export const sdk = new Medusa({
  baseUrl: import.meta.env.VITE_MEDUSA_BACKEND_URL || "http://localhost:9000",
  debug: import.meta.env.DEV,
  auth: {
    type: "session",
  },
});
