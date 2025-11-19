import { MedusaContainer } from "@medusajs/framework/types"
import { ENCRYPTION_MODULE } from "../../encryption"
import EncryptionService from "../../encryption/service"
import type { EncryptedData } from "../../encryption"

/**
 * Token Helper Utilities
 * 
 * Provides convenient functions for encrypting and decrypting tokens
 * stored in SocialPlatform api_config.
 */

/**
 * Decrypt access token from platform api_config
 * 
 * @param apiConfig - The api_config object from SocialPlatform
 * @param container - MedusaJS container for service resolution
 * @returns Decrypted access token
 */
export function decryptAccessToken(
  apiConfig: Record<string, any>,
  container: MedusaContainer
): string {
  // Try encrypted token first (new format)
  if (apiConfig.access_token_encrypted) {
    const encryptionService = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    return encryptionService.decrypt(apiConfig.access_token_encrypted as EncryptedData)
  }
  
  // Fallback to plaintext (backward compatibility)
  if (apiConfig.access_token) {
    console.warn("[Token Helper] Using plaintext access_token (not encrypted). Consider re-authenticating.")
    return apiConfig.access_token
  }
  
  throw new Error("No access token found in api_config")
}

/**
 * Decrypt refresh token from platform api_config
 * 
 * @param apiConfig - The api_config object from SocialPlatform
 * @param container - MedusaJS container for service resolution
 * @returns Decrypted refresh token or null
 */
export function decryptRefreshToken(
  apiConfig: Record<string, any>,
  container: MedusaContainer
): string | null {
  // Try encrypted token first (new format)
  if (apiConfig.refresh_token_encrypted) {
    const encryptionService = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    return encryptionService.decrypt(apiConfig.refresh_token_encrypted as EncryptedData)
  }
  
  // Fallback to plaintext (backward compatibility)
  if (apiConfig.refresh_token) {
    console.warn("[Token Helper] Using plaintext refresh_token (not encrypted). Consider re-authenticating.")
    return apiConfig.refresh_token
  }
  
  return null
}

/**
 * Decrypt page access token from platform api_config (Facebook only)
 * 
 * @param apiConfig - The api_config object from SocialPlatform
 * @param container - MedusaJS container for service resolution
 * @returns Decrypted page access token or null
 */
export function decryptPageAccessToken(
  apiConfig: Record<string, any>,
  container: MedusaContainer
): string | null {
  // Try encrypted token first (new format)
  if (apiConfig.page_access_token_encrypted) {
    const encryptionService = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    return encryptionService.decrypt(apiConfig.page_access_token_encrypted as EncryptedData)
  }
  
  // Fallback to plaintext (backward compatibility)
  if (apiConfig.page_access_token) {
    console.warn("[Token Helper] Using plaintext page_access_token (not encrypted). Consider re-authenticating.")
    return apiConfig.page_access_token
  }
  
  return null
}

/**
 * Decrypt user access token from platform api_config (Facebook only)
 * 
 * @param apiConfig - The api_config object from SocialPlatform
 * @param container - MedusaJS container for service resolution
 * @returns Decrypted user access token or null
 */
export function decryptUserAccessToken(
  apiConfig: Record<string, any>,
  container: MedusaContainer
): string | null {
  // Try encrypted token first (new format)
  if (apiConfig.user_access_token_encrypted) {
    const encryptionService = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    return encryptionService.decrypt(apiConfig.user_access_token_encrypted as EncryptedData)
  }
  
  // Fallback to plaintext (backward compatibility)
  if (apiConfig.user_access_token) {
    console.warn("[Token Helper] Using plaintext user_access_token (not encrypted). Consider re-authenticating.")
    return apiConfig.user_access_token
  }
  
  return null
}

/**
 * Get all decrypted tokens from platform api_config
 * 
 * @param apiConfig - The api_config object from SocialPlatform
 * @param container - MedusaJS container for service resolution
 * @returns Object with all decrypted tokens
 */
export function decryptAllTokens(
  apiConfig: Record<string, any>,
  container: MedusaContainer
): {
  accessToken: string
  refreshToken: string | null
  pageAccessToken: string | null
  userAccessToken: string | null
} {
  return {
    accessToken: decryptAccessToken(apiConfig, container),
    refreshToken: decryptRefreshToken(apiConfig, container),
    pageAccessToken: decryptPageAccessToken(apiConfig, container),
    userAccessToken: decryptUserAccessToken(apiConfig, container),
  }
}

/**
 * Check if tokens are encrypted (new format) or plaintext (old format)
 * 
 * @param apiConfig - The api_config object from SocialPlatform
 * @returns True if tokens are encrypted, false if plaintext
 */
export function hasEncryptedTokens(apiConfig: Record<string, any>): boolean {
  return !!(
    apiConfig.access_token_encrypted ||
    apiConfig.refresh_token_encrypted ||
    apiConfig.page_access_token_encrypted ||
    apiConfig.user_access_token_encrypted
  )
}

/**
 * Encrypt tokens for storage in api_config
 * 
 * @param tokens - Object with tokens to encrypt
 * @param container - MedusaJS container for service resolution
 * @returns Object with encrypted tokens
 */
export function encryptTokens(
  tokens: {
    accessToken?: string
    refreshToken?: string | null
    pageAccessToken?: string | null
    userAccessToken?: string | null
  },
  container: MedusaContainer
): {
  access_token_encrypted?: EncryptedData
  refresh_token_encrypted?: EncryptedData | null
  page_access_token_encrypted?: EncryptedData | null
  user_access_token_encrypted?: EncryptedData | null
} {
  const encryptionService = container.resolve(ENCRYPTION_MODULE) as EncryptionService
  
  const encrypted: any = {}
  
  if (tokens.accessToken) {
    encrypted.access_token_encrypted = encryptionService.encrypt(tokens.accessToken)
  }
  
  if (tokens.refreshToken) {
    encrypted.refresh_token_encrypted = encryptionService.encrypt(tokens.refreshToken)
  }
  
  if (tokens.pageAccessToken) {
    encrypted.page_access_token_encrypted = encryptionService.encrypt(tokens.pageAccessToken)
  }
  
  if (tokens.userAccessToken) {
    encrypted.user_access_token_encrypted = encryptionService.encrypt(tokens.userAccessToken)
  }
  
  return encrypted
}
