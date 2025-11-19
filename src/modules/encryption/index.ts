import { Module } from "@medusajs/framework/utils";
import EncryptionService from "./service";

export const ENCRYPTION_MODULE = "encryption";

// Export types
export type { EncryptedData } from "./service";

const EncryptionModule = Module(ENCRYPTION_MODULE, {
  service: EncryptionService,
});

export default EncryptionModule;
