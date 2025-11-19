import EncryptionService from "../service"

describe("EncryptionService", () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env }
    
    // Set test encryption key (32 bytes)
    process.env.ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString("base64")
    process.env.ENCRYPTION_KEY_VERSION = "1"
  })

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv
  })

  describe("constructor", () => {
    it("should throw error if ENCRYPTION_KEY is not set", () => {
      delete process.env.ENCRYPTION_KEY
      delete process.env.ENCRYPTION_KEY_V1
      
      expect(() => new EncryptionService()).toThrow(
        "ENCRYPTION_KEY not found in environment variables"
      )
    })

    it("should throw error if key length is invalid", () => {
      process.env.ENCRYPTION_KEY = Buffer.from("short").toString("base64")
      
      expect(() => new EncryptionService()).toThrow(
        "Invalid encryption key length"
      )
    })

    it("should accept ENCRYPTION_KEY_V1 as fallback", () => {
      delete process.env.ENCRYPTION_KEY
      process.env.ENCRYPTION_KEY_V1 = Buffer.from("b".repeat(32)).toString("base64")
      
      expect(() => new EncryptionService()).not.toThrow()
    })

    it("should default to version 1 if not specified", () => {
      delete process.env.ENCRYPTION_KEY_VERSION
      const service = new EncryptionService()
      
      expect(service.getCurrentKeyVersion()).toBe(1)
    })
  })

  describe("encrypt", () => {
    let service: EncryptionService

    beforeEach(() => {
      service = new EncryptionService()
    })

    it("should encrypt plaintext successfully", () => {
      const plaintext = "my-secret-token-12345"
      const encrypted = service.encrypt(plaintext)

      expect(encrypted).toHaveProperty("encrypted")
      expect(encrypted).toHaveProperty("iv")
      expect(encrypted).toHaveProperty("authTag")
      expect(encrypted).toHaveProperty("keyVersion")
      expect(encrypted.keyVersion).toBe(1)
      expect(encrypted.encrypted).not.toBe(plaintext)
    })

    it("should throw error for empty string", () => {
      expect(() => service.encrypt("")).toThrow("Cannot encrypt empty string")
    })

    it("should generate unique IVs for each encryption", () => {
      const plaintext = "same-token"
      const encrypted1 = service.encrypt(plaintext)
      const encrypted2 = service.encrypt(plaintext)

      expect(encrypted1.iv).not.toBe(encrypted2.iv)
      expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted)
      expect(encrypted1.authTag).not.toBe(encrypted2.authTag)
    })

    it("should handle special characters", () => {
      const plaintext = "token-with-special-chars: !@#$%^&*()_+-=[]{}|;':\",./<>?"
      const encrypted = service.encrypt(plaintext)

      expect(encrypted.encrypted).toBeTruthy()
    })

    it("should handle unicode characters", () => {
      const plaintext = "token-with-unicode: 你好世界 🚀 émojis"
      const encrypted = service.encrypt(plaintext)

      expect(encrypted.encrypted).toBeTruthy()
    })

    it("should handle very long strings", () => {
      const plaintext = "a".repeat(10000)
      const encrypted = service.encrypt(plaintext)

      expect(encrypted.encrypted).toBeTruthy()
    })
  })

  describe("decrypt", () => {
    let service: EncryptionService

    beforeEach(() => {
      service = new EncryptionService()
    })

    it("should decrypt encrypted data correctly", () => {
      const plaintext = "my-secret-token-12345"
      const encrypted = service.encrypt(plaintext)
      const decrypted = service.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it("should throw error for empty data", () => {
      expect(() => service.decrypt(null as any)).toThrow("Cannot decrypt empty data")
      expect(() => service.decrypt({} as any)).toThrow("Cannot decrypt empty data")
    })

    it("should fail decryption with tampered data", () => {
      const plaintext = "my-token"
      const encrypted = service.encrypt(plaintext)
      
      // Tamper with encrypted data
      encrypted.encrypted = encrypted.encrypted.slice(0, -5) + "XXXXX"

      expect(() => service.decrypt(encrypted)).toThrow("Decryption failed")
    })

    it("should fail decryption with tampered IV", () => {
      const plaintext = "my-token"
      const encrypted = service.encrypt(plaintext)
      
      // Tamper with IV
      encrypted.iv = Buffer.from("wrong-iv-123").toString("base64")

      expect(() => service.decrypt(encrypted)).toThrow("Decryption failed")
    })

    it("should fail decryption with tampered auth tag", () => {
      const plaintext = "my-token"
      const encrypted = service.encrypt(plaintext)
      
      // Tamper with auth tag
      encrypted.authTag = Buffer.from("wrong-tag-12").toString("base64")

      expect(() => service.decrypt(encrypted)).toThrow("Decryption failed")
    })

    it("should handle special characters in decryption", () => {
      const plaintext = "token-with-special: !@#$%^&*()"
      const encrypted = service.encrypt(plaintext)
      const decrypted = service.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it("should handle unicode characters in decryption", () => {
      const plaintext = "unicode: 你好 🚀"
      const encrypted = service.encrypt(plaintext)
      const decrypted = service.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })
  })

  describe("key rotation", () => {
    it("should decrypt data encrypted with old key version", () => {
      // Encrypt with version 1
      const oldKey = Buffer.from("b".repeat(32)).toString("base64")
      process.env.ENCRYPTION_KEY = oldKey
      process.env.ENCRYPTION_KEY_VERSION = "1"
      const service1 = new EncryptionService()
      const plaintext = "my-token"
      const encrypted = service1.encrypt(plaintext)

      // Use version 2, but keep old key available
      process.env.ENCRYPTION_KEY_V1 = oldKey  // Keep old key for decryption
      process.env.ENCRYPTION_KEY = Buffer.from("c".repeat(32)).toString("base64")
      process.env.ENCRYPTION_KEY_VERSION = "2"
      const service2 = new EncryptionService()

      // Should still be able to decrypt with old key
      const decrypted = service2.decrypt(encrypted)
      expect(decrypted).toBe(plaintext)
    })

    it("should throw error if old key version not found", () => {
      const encrypted = {
        encrypted: "some-data",
        iv: "some-iv",
        authTag: "some-tag",
        keyVersion: 5
      }

      const service = new EncryptionService()
      
      expect(() => service.decrypt(encrypted)).toThrow(
        "Encryption key version 5 not found"
      )
    })

    it("should detect when re-encryption is needed", () => {
      process.env.ENCRYPTION_KEY_VERSION = "1"
      const service1 = new EncryptionService()
      const encrypted = service1.encrypt("my-token")

      // Upgrade to version 2
      process.env.ENCRYPTION_KEY_VERSION = "2"
      const service2 = new EncryptionService()

      expect(service2.needsReEncryption(encrypted)).toBe(true)
    })

    it("should not need re-encryption for current version", () => {
      const service = new EncryptionService()
      const encrypted = service.encrypt("my-token")

      expect(service.needsReEncryption(encrypted)).toBe(false)
    })

    it("should re-encrypt data with new key version", () => {
      // Encrypt with version 1
      const oldKey = Buffer.from("b".repeat(32)).toString("base64")
      process.env.ENCRYPTION_KEY = oldKey
      process.env.ENCRYPTION_KEY_VERSION = "1"
      const service1 = new EncryptionService()
      const plaintext = "my-token"
      const encrypted1 = service1.encrypt(plaintext)

      // Upgrade to version 2, but keep old key available
      process.env.ENCRYPTION_KEY_V1 = oldKey  // Keep old key for decryption
      process.env.ENCRYPTION_KEY = Buffer.from("c".repeat(32)).toString("base64")
      process.env.ENCRYPTION_KEY_VERSION = "2"
      const service2 = new EncryptionService()

      // Re-encrypt
      const encrypted2 = service2.reEncrypt(encrypted1)

      expect(encrypted2.keyVersion).toBe(2)
      expect(encrypted2.encrypted).not.toBe(encrypted1.encrypted)
      
      // Should decrypt to same plaintext
      const decrypted = service2.decrypt(encrypted2)
      expect(decrypted).toBe(plaintext)
    })
  })

  describe("edge cases", () => {
    let service: EncryptionService

    beforeEach(() => {
      service = new EncryptionService()
    })

    it("should handle empty-looking strings", () => {
      const plaintext = "   "
      const encrypted = service.encrypt(plaintext)
      const decrypted = service.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it("should handle newlines and tabs", () => {
      const plaintext = "line1\nline2\tline3"
      const encrypted = service.encrypt(plaintext)
      const decrypted = service.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it("should handle JSON strings", () => {
      const plaintext = JSON.stringify({ key: "value", nested: { data: 123 } })
      const encrypted = service.encrypt(plaintext)
      const decrypted = service.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
      expect(JSON.parse(decrypted)).toEqual({ key: "value", nested: { data: 123 } })
    })

    it("should handle base64 strings", () => {
      const plaintext = Buffer.from("some-data").toString("base64")
      const encrypted = service.encrypt(plaintext)
      const decrypted = service.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })
  })

  describe("performance", () => {
    let service: EncryptionService

    beforeEach(() => {
      service = new EncryptionService()
    })

    it("should encrypt/decrypt 100 tokens quickly", () => {
      const tokens = Array.from({ length: 100 }, (_, i) => `token-${i}`)
      
      const startEncrypt = Date.now()
      const encrypted = tokens.map(t => service.encrypt(t))
      const encryptTime = Date.now() - startEncrypt

      const startDecrypt = Date.now()
      const decrypted = encrypted.map(e => service.decrypt(e))
      const decryptTime = Date.now() - startDecrypt

      expect(decrypted).toEqual(tokens)
      expect(encryptTime).toBeLessThan(1000) // Should take less than 1 second
      expect(decryptTime).toBeLessThan(1000)
    })
  })
})
