import crypto from "crypto"
import { MedusaError } from "@medusajs/utils"

/**
 * Encrypted data structure returned by encryption operations
 */
export interface EncryptedData {
  encrypted: string      // Base64 encoded encrypted data
  iv: string            // Base64 encoded initialization vector
  authTag: string       // Base64 encoded authentication tag
  keyVersion: number    // For key rotation support
}

/**
 * Encryption Service
 * 
 * Provides AES-256-GCM encryption/decryption for sensitive data like tokens and API keys.
 * Supports key rotation without data loss.
 * 
 * @example
 * ```typescript
 * const encryptionService = container.resolve("encryptionService")
 * const encrypted = encryptionService.encrypt("my-secret-token")
 * const decrypted = encryptionService.decrypt(encrypted)
 * ```
 */
class EncryptionService {
  private readonly algorithm = "aes-256-gcm"
  private readonly keyVersion: number
  private readonly encryptionKey: Buffer

  constructor() {
    // Get encryption key from environment
    const keyString = process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY_V1
    
    if (!keyString) {
      throw new Error(
        "ENCRYPTION_KEY not found in environment variables. " +
        "Generate one with: openssl rand -base64 32"
      )
    }

    // Validate key length (must be 32 bytes for AES-256)
    const keyBuffer = Buffer.from(keyString, "base64")
    if (keyBuffer.length !== 32) {
      throw new Error(
        `Invalid encryption key length: ${keyBuffer.length} bytes. ` +
        "Must be 32 bytes (256 bits) for AES-256."
      )
    }

    this.encryptionKey = keyBuffer
    this.keyVersion = parseInt(process.env.ENCRYPTION_KEY_VERSION || "1", 10)
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   * 
   * @param plaintext - The plaintext string to encrypt
   * @returns Encrypted data with IV and authentication tag
   * @throws {MedusaError} If plaintext is empty or encryption fails
   */
  encrypt(plaintext: string): EncryptedData {
    if (!plaintext) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot encrypt empty string"
      )
    }

    try {
      // Generate random IV (12 bytes recommended for GCM)
      const iv = crypto.randomBytes(12)

      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv)

      // Encrypt data
      let encrypted = cipher.update(plaintext, "utf8", "base64")
      encrypted += cipher.final("base64")

      // Get authentication tag (prevents tampering)
      const authTag = cipher.getAuthTag()

      return {
        encrypted,
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        keyVersion: this.keyVersion,
      }
    } catch (error) {
      console.error("Encryption failed:", error)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Encryption failed: ${error.message}`
      )
    }
  }

  /**
   * Decrypt encrypted data using AES-256-GCM
   * 
   * @param encryptedData - The encrypted data object
   * @returns Decrypted plaintext string
   * @throws {MedusaError} If data is invalid or decryption fails
   */
  decrypt(encryptedData: EncryptedData): string {
    if (!encryptedData || !encryptedData.encrypted) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot decrypt empty data"
      )
    }

    try {
      // Get the appropriate key for this data's version
      const key = this.getKeyForVersion(encryptedData.keyVersion)

      // Convert from base64
      const iv = Buffer.from(encryptedData.iv, "base64")
      const authTag = Buffer.from(encryptedData.authTag, "base64")

      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv)
      decipher.setAuthTag(authTag)

      // Decrypt data
      let decrypted = decipher.update(encryptedData.encrypted, "base64", "utf8")
      decrypted += decipher.final("utf8")

      return decrypted
    } catch (error) {
      console.error("Decryption failed:", error)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Decryption failed: ${error.message}. The data may be corrupted or tampered with.`
      )
    }
  }

  /**
   * Get encryption key for a specific version (supports key rotation)
   * 
   * @param version - The key version to retrieve
   * @returns The encryption key buffer
   * @throws {MedusaError} If key version not found
   */
  private getKeyForVersion(version: number): Buffer {
    if (version === this.keyVersion) {
      return this.encryptionKey
    }

    // Support for old keys during rotation
    const oldKeyString = process.env[`ENCRYPTION_KEY_V${version}`]
    if (!oldKeyString) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Encryption key version ${version} not found. Cannot decrypt data.`
      )
    }

    const keyBuffer = Buffer.from(oldKeyString, "base64")
    if (keyBuffer.length !== 32) {
      throw new Error(
        `Invalid encryption key length for version ${version}: ${keyBuffer.length} bytes`
      )
    }

    return keyBuffer
  }

  /**
   * Check if data needs re-encryption (old key version)
   * 
   * @param encryptedData - The encrypted data to check
   * @returns True if data should be re-encrypted with current key
   */
  needsReEncryption(encryptedData: EncryptedData): boolean {
    return encryptedData.keyVersion < this.keyVersion
  }

  /**
   * Re-encrypt data with current key version
   * 
   * @param encryptedData - The encrypted data to re-encrypt
   * @returns Newly encrypted data with current key version
   */
  reEncrypt(encryptedData: EncryptedData): EncryptedData {
    const plaintext = this.decrypt(encryptedData)
    return this.encrypt(plaintext)
  }

  /**
   * Get current key version
   */
  getCurrentKeyVersion(): number {
    return this.keyVersion
  }
}

export default EncryptionService;
