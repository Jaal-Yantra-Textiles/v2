
/// <reference types="vite/client" />
import Medusa from "@medusajs/js-sdk";

// Vite environment variables - must be prefixed with VITE_ to be exposed to client
export const VITE_MEDUSA_BACKEND_URL = import.meta.env.VITE_MEDUSA_BACKEND_URL || "/";
export const MEDUSA_DEBUG = import.meta.env.DEV;

export const sdk = new Medusa({
  baseUrl: VITE_MEDUSA_BACKEND_URL || "http://localhost:9000",
  debug: MEDUSA_DEBUG,
  auth: {
    type: "session",
  },
});
