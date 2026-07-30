import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup";
import { ENCRYPTION_MODULE } from "../../../src/modules/encryption";
import EncryptionService from "../../../src/modules/encryption/service";
import { SOCIALS_MODULE } from "../../../src/modules/socials";

jest.setTimeout(60000);

setupSharedTestSuite(() => {
  let headers;
  const { api, getContainer } = getSharedTestEnv();

  beforeEach(async () => {
    await createAdminUser(getContainer());
    headers = await getAuthHeaders(api);
  });

  describe("OAuth Flow with Encryption", () => {
      describe("Complete OAuth Flow Simulation", () => {
        it("should simulate full OAuth flow with token encryption", async () => {
          console.log("\n🔐 === OAUTH FLOW WITH ENCRYPTION TEST ===\n");

          // ============================================
          // STEP 1: Create Social Platform
          // ============================================
          console.log("📝 STEP 1: Creating social platform...");
          
          const createResponse = await api.post(
            "/admin/social-platforms",
            {
              name: "Facebook",
              category: "social",
              auth_type: "oauth2",
              icon_url: "https://example.com/facebook.png",
              base_url: "https://graph.facebook.com",
              description: "Facebook OAuth Test Platform",
              status: "pending", // Pending until OAuth completes
            },
            headers
          );

          expect(createResponse.status).toBe(201);
          const platform = createResponse.data.socialPlatform;
          console.log(`✅ Platform created: ${platform.id}`);
          console.log(`   - Name: ${platform.name}`);
          console.log(`   - Category: ${platform.category}`);
          console.log(`   - Auth Type: ${platform.auth_type}`);
          console.log(`   - Status: ${platform.status}`);

          // ============================================
          // STEP 2: Simulate OAuth Callback (Token Exchange)
          // ============================================
          console.log("\n🔄 STEP 2: Simulating OAuth callback...");
          
          // In real flow, user would be redirected to provider's OAuth page
          // Provider would redirect back with code
          // We simulate the callback with mock tokens
          
          const mockOAuthTokens = {
            access_token: "mock_facebook_access_token_12345",
            refresh_token: "mock_facebook_refresh_token_67890",
            token_type: "Bearer",
            expires_in: 5184000, // 60 days
            scope: "pages_show_list,pages_read_engagement,instagram_basic",
          };

          console.log("📦 Mock OAuth tokens received:");
          console.log(`   - Access Token: ${mockOAuthTokens.access_token.substring(0, 20)}...`);
          console.log(`   - Refresh Token: ${mockOAuthTokens.refresh_token.substring(0, 20)}...`);
          console.log(`   - Token Type: ${mockOAuthTokens.token_type}`);
          console.log(`   - Expires In: ${mockOAuthTokens.expires_in}s`);

          // ============================================
          // STEP 3: Encrypt Tokens (Simulating OAuth Callback Logic)
          // ============================================
          console.log("\n🔐 STEP 3: Encrypting tokens...");
          
          const encryptionService = getContainer().resolve(ENCRYPTION_MODULE) as EncryptionService;
          
          const accessTokenEncrypted = encryptionService.encrypt(mockOAuthTokens.access_token);
          const refreshTokenEncrypted = encryptionService.encrypt(mockOAuthTokens.refresh_token);

          console.log("✅ Tokens encrypted successfully");
          console.log(`   - Encrypted data structure:`);
          console.log(`     • encrypted: ${accessTokenEncrypted.encrypted.substring(0, 20)}...`);
          console.log(`     • iv: ${accessTokenEncrypted.iv.substring(0, 20)}...`);
          console.log(`     • authTag: ${accessTokenEncrypted.authTag.substring(0, 20)}...`);
          console.log(`     • keyVersion: ${accessTokenEncrypted.keyVersion}`);

          // ============================================
          // STEP 4: Update Platform with Encrypted Tokens
          // ============================================
          console.log("\n💾 STEP 4: Storing encrypted tokens in database...");
          
          const updateResponse = await api.post(
            `/admin/social-platforms/${platform.id}`,
            {
              status: "active", // OAuth completed successfully
              api_config: {
                provider: "facebook",
                provider_key: "mock_page_id_123",
                
                // Encrypted tokens (NEW - secure storage)
                access_token_encrypted: accessTokenEncrypted,
                refresh_token_encrypted: refreshTokenEncrypted,
                
                // Plaintext tokens (OLD - backward compatibility)
                access_token: mockOAuthTokens.access_token,
                refresh_token: mockOAuthTokens.refresh_token,
                
                // Non-sensitive data
                token_type: mockOAuthTokens.token_type,
                scope: mockOAuthTokens.scope,
                expires_in: mockOAuthTokens.expires_in,
                retrieved_at: new Date(),
                
                // Mock metadata
                metadata: {
                  pages: [
                    { id: "mock_page_id_123", name: "Test Page" }
                  ],
                  ig_accounts: [
                    { id: "mock_ig_id_456", username: "test_account" }
                  ],
                },
              },
            },
            headers
          );

          expect(updateResponse.status).toBe(200);
          const updatedPlatform = updateResponse.data.socialPlatform;
          
          console.log("✅ Platform updated with encrypted tokens");
          console.log(`   - Status: ${updatedPlatform.status}`);
          console.log(`   - Has api_config: ${!!updatedPlatform.api_config}`);
          console.log(`   - Has encrypted access_token: ${!!updatedPlatform.api_config?.access_token_encrypted}`);
          console.log(`   - Has encrypted refresh_token: ${!!updatedPlatform.api_config?.refresh_token_encrypted}`);
          console.log(`   - Has plaintext access_token (backward compat): ${!!updatedPlatform.api_config?.access_token}`);

          // ============================================
          // STEP 5: Verify Encryption in Database
          // ============================================
          console.log("\n🔍 STEP 5: Verifying encryption in database...");
          
          // Read through the module, not the API. The admin response redacts
          // every `*_encrypted` blob and reports `*_present: true` instead, so
          // asking the endpoint for ciphertext gets undefined -- which is the
          // redaction working, not encryption failing. At-rest encryption has
          // to be checked at rest.
          const getResponse = await api.get(
            `/admin/social-platforms/${platform.id}`,
            headers
          );

          expect(getResponse.status).toBe(200);
          expect(
            getResponse.data.socialPlatform.api_config.access_token_encrypted
          ).toBeUndefined();
          expect(
            getResponse.data.socialPlatform.api_config.access_token_present
          ).toBe(true);

          const socialsService: any = getContainer().resolve(SOCIALS_MODULE);
          const retrievedPlatform = await socialsService.retrieveSocialPlatform(
            platform.id
          );

          // Verify encrypted tokens exist
          expect(retrievedPlatform.api_config.access_token_encrypted).toBeDefined();
          expect(retrievedPlatform.api_config.access_token_encrypted.encrypted).toBeDefined();
          expect(retrievedPlatform.api_config.access_token_encrypted.iv).toBeDefined();
          expect(retrievedPlatform.api_config.access_token_encrypted.authTag).toBeDefined();
          expect(retrievedPlatform.api_config.access_token_encrypted.keyVersion).toBe(1);
          
          console.log("✅ Encrypted tokens verified in database");
          console.log(`   - Encrypted structure intact: ✓`);
          console.log(`   - Key version: ${retrievedPlatform.api_config.access_token_encrypted.keyVersion}`);

          // ============================================
          // STEP 6: Decrypt Tokens (Simulating Workflow Usage)
          // ============================================
          console.log("\n🔓 STEP 6: Decrypting tokens for use...");
          
          const decryptedAccessToken = encryptionService.decrypt(
            retrievedPlatform.api_config.access_token_encrypted
          );
          const decryptedRefreshToken = encryptionService.decrypt(
            retrievedPlatform.api_config.refresh_token_encrypted
          );

          // Verify decrypted tokens match original
          expect(decryptedAccessToken).toBe(mockOAuthTokens.access_token);
          expect(decryptedRefreshToken).toBe(mockOAuthTokens.refresh_token);

          console.log("✅ Tokens decrypted successfully");
          console.log(`   - Decrypted access token matches original: ✓`);
          console.log(`   - Decrypted refresh token matches original: ✓`);
          console.log(`   - Decrypted value: ${decryptedAccessToken.substring(0, 20)}...`);

          // ============================================
          // STEP 7: Test Token Helper Functions
          // ============================================
          console.log("\n🛠️  STEP 7: Testing token helper functions...");
          
          const { decryptAccessToken, hasEncryptedTokens } = require("../../../src/modules/socials/utils/token-helpers");
          
          // Test hasEncryptedTokens
          const isEncrypted = hasEncryptedTokens(retrievedPlatform.api_config);
          expect(isEncrypted).toBe(true);
          console.log(`✅ hasEncryptedTokens() returned: ${isEncrypted}`);
          
          // Test decryptAccessToken
          const helperDecryptedToken = decryptAccessToken(
            retrievedPlatform.api_config,
            getContainer()
          );
          expect(helperDecryptedToken).toBe(mockOAuthTokens.access_token);
          console.log(`✅ decryptAccessToken() works correctly`);

          // ============================================
          // STEP 8: Test Backward Compatibility
          // ============================================
          console.log("\n🔄 STEP 8: Testing backward compatibility...");
          
          // Create a platform with only plaintext tokens (old format)
          const legacyPlatformResponse = await api.post(
            "/admin/social-platforms",
            {
              name: "Legacy Twitter",
              category: "social",
              auth_type: "oauth2",
              status: "active",
              api_config: {
                // Only plaintext (no encryption)
                access_token: "legacy_plaintext_token_12345",
                refresh_token: "legacy_plaintext_refresh_67890",
              },
            },
            headers
          );

          const legacyPlatform = legacyPlatformResponse.data.socialPlatform;
          console.log(`✅ Legacy platform created: ${legacyPlatform.id}`);

          // Again from the module: redaction strips the plaintext `access_token`
          // from the response too, so the stored row is the only place to read
          // the legacy shape from.
          const storedLegacy = await socialsService.retrieveSocialPlatform(
            legacyPlatform.id
          );

          // Test that helper can still read plaintext tokens
          const legacyToken = decryptAccessToken(
            storedLegacy.api_config,
            getContainer()
          );
          expect(legacyToken).toBe("legacy_plaintext_token_12345");
          console.log(`✅ Helper successfully read plaintext token (backward compat)`);
          console.log(`   - Warning should be logged about plaintext usage`);

          // ============================================
          // STEP 9: Test Tamper Detection
          // ============================================
          console.log("\n🛡️  STEP 9: Testing tamper detection...");
          
          // Tamper with the encrypted data by modifying the encrypted content
          // This will cause the authentication tag verification to fail
          const originalEncrypted = retrievedPlatform.api_config.access_token_encrypted.encrypted;
          const tamperedEncrypted = originalEncrypted.substring(0, originalEncrypted.length - 4) + "XXXX";
          
          const tamperedData = {
            ...retrievedPlatform.api_config.access_token_encrypted,
            encrypted: tamperedEncrypted,
          };

          // Attempt to decrypt tampered data
          let tamperDetected = false;
          try {
            encryptionService.decrypt(tamperedData);
            console.log("⚠️  Decryption succeeded unexpectedly - tamper not detected");
          } catch (error) {
            tamperDetected = true;
            console.log(`✅ Tamper detected: ${error.message}`);
          }

          expect(tamperDetected).toBe(true);
          console.log(`✅ Encryption is tamper-proof`);

          // ============================================
          // STEP 10: Cleanup
          // ============================================
          console.log("\n🧹 STEP 10: Cleaning up...");
          
          await api.delete(`/admin/social-platforms/${platform.id}`, headers);
          await api.delete(`/admin/social-platforms/${legacyPlatform.id}`, headers);
          
          console.log("✅ Test platforms deleted");

          // ============================================
          // SUMMARY
          // ============================================
          console.log("\n✨ === TEST SUMMARY ===");
          console.log("✅ Platform creation: PASSED");
          console.log("✅ Token encryption: PASSED");
          console.log("✅ Database storage: PASSED");
          console.log("✅ Token decryption: PASSED");
          console.log("✅ Helper functions: PASSED");
          console.log("✅ Backward compatibility: PASSED");
          console.log("✅ Tamper detection: PASSED");
          console.log("\n🎉 All OAuth encryption tests PASSED!\n");
        });
      });

      describe("Token Encryption Edge Cases", () => {
        it("should handle missing tokens gracefully", async () => {
          console.log("\n🧪 Testing missing token handling...");
          
          const platformResponse = await api.post(
            "/admin/social-platforms",
            {
              name: "Empty Platform",
              category: "social",
              auth_type: "oauth2",
              api_config: {}, // No tokens
            },
            headers
          );

          const platform = platformResponse.data.socialPlatform;
          
          const { decryptAccessToken } = require("../../../src/modules/socials/utils/token-helpers");
          
          // Should throw error for missing token
          expect(() => {
            decryptAccessToken(platform.api_config, getContainer());
          }).toThrow("No access token found");

          console.log("✅ Missing token error handled correctly");

          await api.delete(`/admin/social-platforms/${platform.id}`, headers);
        });

        it("should handle null api_config", async () => {
          console.log("\n🧪 Testing null api_config handling...");
          
          const platformResponse = await api.post(
            "/admin/social-platforms",
            {
              name: "Null Config Platform",
              category: "social",
              auth_type: "oauth2",
              api_config: null,
            },
            headers
          );

          const platform = platformResponse.data.socialPlatform;
          
          const { decryptAccessToken } = require("../../../src/modules/socials/utils/token-helpers");
          
          // Should throw error for null config
          expect(() => {
            decryptAccessToken(platform.api_config, getContainer());
          }).toThrow();

          console.log("✅ Null config error handled correctly");

          await api.delete(`/admin/social-platforms/${platform.id}`, headers);
        });

        it("should encrypt and decrypt special characters", async () => {
          console.log("\n🧪 Testing special characters in tokens...");
          
          const encryptionService = getContainer().resolve(ENCRYPTION_MODULE) as EncryptionService;
          
          const specialToken = "token_with_special_chars_!@#$%^&*()_+-=[]{}|;:',.<>?/~`";
          const encrypted = encryptionService.encrypt(specialToken);
          const decrypted = encryptionService.decrypt(encrypted);
          
          expect(decrypted).toBe(specialToken);
          console.log("✅ Special characters encrypted/decrypted correctly");
        });

        it("should encrypt and decrypt very long tokens", async () => {
          console.log("\n🧪 Testing very long tokens...");
          
          const encryptionService = getContainer().resolve(ENCRYPTION_MODULE) as EncryptionService;
          
          const longToken = "a".repeat(10000); // 10KB token
          const encrypted = encryptionService.encrypt(longToken);
          const decrypted = encryptionService.decrypt(encrypted);
          
          expect(decrypted).toBe(longToken);
          expect(decrypted.length).toBe(10000);
          console.log("✅ Long token (10KB) encrypted/decrypted correctly");
        });

        it("should encrypt and decrypt unicode characters", async () => {
          console.log("\n🧪 Testing unicode characters...");
          
          const encryptionService = getContainer().resolve(ENCRYPTION_MODULE) as EncryptionService;
          
          const unicodeToken = "token_with_emoji_🔐🚀✨_and_中文_and_العربية";
          const encrypted = encryptionService.encrypt(unicodeToken);
          const decrypted = encryptionService.decrypt(encrypted);
          
          expect(decrypted).toBe(unicodeToken);
          console.log("✅ Unicode characters encrypted/decrypted correctly");
        });
      });

      describe("Multiple Platform OAuth Flows", () => {
        it("should handle multiple platforms with different tokens", async () => {
          console.log("\n🧪 Testing multiple platforms...");
          
          const encryptionService = getContainer().resolve(ENCRYPTION_MODULE) as EncryptionService;
          const platforms: any[] = [];

          // Create multiple platforms with different tokens
          const platformConfigs = [
            { name: "Facebook", token: "fb_token_123" },
            { name: "Twitter", token: "twitter_token_456" },
            { name: "Instagram", token: "ig_token_789" },
          ];

          for (const config of platformConfigs) {
            const encrypted = encryptionService.encrypt(config.token);
            
            const response = await api.post(
              "/admin/social-platforms",
              {
                name: config.name,
                category: "social",
                auth_type: "oauth2",
                status: "active",
                api_config: {
                  access_token_encrypted: encrypted,
                  access_token: config.token,
                },
              },
              headers
            );

            platforms.push(response.data.socialPlatform);
            console.log(`✅ Created ${config.name} with encrypted token`);
          }

          // Verify each platform has correct encrypted token. The api_config on
          // the create response is redacted, so the ciphertext has to come from
          // the module.
          const { decryptAccessToken } = require("../../../src/modules/socials/utils/token-helpers");
          const socialsService: any = getContainer().resolve(SOCIALS_MODULE);

          for (let i = 0; i < platforms.length; i++) {
            const platform = platforms[i];
            const expectedToken = platformConfigs[i].token;

            const stored = await socialsService.retrieveSocialPlatform(platform.id);
            const decrypted = decryptAccessToken(stored.api_config, getContainer());
            expect(decrypted).toBe(expectedToken);
            console.log(`✅ ${platform.name} token verified`);
          }

          // Cleanup
          for (const platform of platforms) {
            await api.delete(`/admin/social-platforms/${platform.id}`, headers);
          }

          console.log("✅ Multiple platforms test completed");
        });
      });

      describe("Performance Tests", () => {
        it("should encrypt/decrypt tokens quickly", async () => {
          console.log("\n⚡ Testing encryption/decryption performance...");
          
          const encryptionService = getContainer().resolve(ENCRYPTION_MODULE) as EncryptionService;
          const token = "performance_test_token_12345";
          const iterations = 100;

          // Test encryption performance
          const encryptStart = Date.now();
          const encryptedTokens = [];
          for (let i = 0; i < iterations; i++) {
            encryptedTokens.push(encryptionService.encrypt(token));
          }
          const encryptDuration = Date.now() - encryptStart;
          const avgEncryptTime = encryptDuration / iterations;

          console.log(`✅ Encrypted ${iterations} tokens in ${encryptDuration}ms`);
          console.log(`   - Average: ${avgEncryptTime.toFixed(2)}ms per token`);

          // Test decryption performance
          const decryptStart = Date.now();
          for (const encrypted of encryptedTokens) {
            encryptionService.decrypt(encrypted);
          }
          const decryptDuration = Date.now() - decryptStart;
          const avgDecryptTime = decryptDuration / iterations;

          console.log(`✅ Decrypted ${iterations} tokens in ${decryptDuration}ms`);
          console.log(`   - Average: ${avgDecryptTime.toFixed(2)}ms per token`);

          // Performance assertions
          expect(avgEncryptTime).toBeLessThan(5); // Should be < 5ms
          expect(avgDecryptTime).toBeLessThan(5); // Should be < 5ms

          console.log("✅ Performance is acceptable (< 5ms per operation)");
        });
      });
    });
  }
);
