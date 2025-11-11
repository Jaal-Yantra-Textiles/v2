
/// <reference types="vite/client" />
import Medusa from "@medusajs/js-sdk";

// Vite environment variables - must be prefixed with VITE_ to be exposed to client
export const MEDUSA_DEBUG = import.meta.env.DEV;

// API base URL - defaults to relative path for production
// Remove trailing slash to prevent double slashes in URLs
const rawUrl = import.meta.env.VITE_MEDUSA_BACKEND_URL || (import.meta.env.DEV ? "http://localhost:9000" : "");
export const API_BASE_URL = rawUrl.replace(/\/$/, '');
export const VITE_MEDUSA_BACKEND_URL = API_BASE_URL;

export const sdk = new Medusa({
  baseUrl: API_BASE_URL,
  debug: MEDUSA_DEBUG,
  auth: {
    type: "session",
  },
});
