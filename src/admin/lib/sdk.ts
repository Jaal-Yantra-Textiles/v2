import Medusa from "@medusajs/js-sdk";

export const sdk = new Medusa({
  baseUrl: process.env.MEDUSA_BACKEND_URL || "http://localhost:9000",
  debug: process.env.NODE_ENV === "development",
  auth: {
    type: "session",
  },
});
