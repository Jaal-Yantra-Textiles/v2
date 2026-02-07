---
title: "Social Posts API Refactoring - Complete Overview"
sidebar_label: "Refactoring Overview"
sidebar_position: 8
---

# Social Posts API Refactoring - Complete Overview

## 📋 Executive Summary

This refactoring transforms the social posts publishing system from a monolithic route handler (351 lines) to a secure, workflow-based architecture with token encryption, reducing complexity by 87% while adding enterprise-grade security.

---

## 🎯 Goals

1. **Security First** - Encrypt all tokens at rest (AES-256-GCM)
2. **Reduce Complexity** - Move business logic from routes to workflows
3. **Eliminate Duplication** - Unified publishing logic across platforms
4. **Improve Testability** - Independently testable workflow steps
5. **Enable Observability** - Track workflow execution and failures

---

## 📊 Current Problems

### 1. Route Handler Complexity
- **351 lines** of business logic in `/social-posts/[id]/publish/route.ts`
- Platform detection, token resolution, validation, retry logic all mixed together
- Difficult to test, maintain, and extend

### 2. Security Risk
- **Tokens stored in plaintext** in database
- Vulnerable to database breaches
- Exposed in backups and logs
- No compliance with GDPR/PCI DSS

### 3. Code Duplication
- Logic duplicated between:
  - `/social-posts/[id]/publish`
  - `/socials/publish-both`
- Same validation, token resolution, content detection repeated

### 4. Inconsistent Patterns
- Some routes use workflows
- Others use direct service calls
- Mixed error handling approaches

---

## 🏗️ Proposed Architecture

### Before
```
┌─────────────────────────────────────────┐
│  Route Handler (351 lines)              │
│  ├─ Platform detection                  │
│  ├─ Token resolution                    │
│  ├─ Content extraction                  │
│  ├─ Validation                          │
│  ├─ Smart retry logic                   │
│  ├─ Publishing                          │
│  └─ Post update                         │
└─────────────────────────────────────────┘
         ↓
   Direct Service Calls
         ↓
   Facebook/Instagram/Twitter APIs
```

### After
```
┌─────────────────────────────────────────┐
│  Route Handler (45 lines)               │
│  └─ Call Workflow                       │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│  Unified Publishing Workflow            │
│  ├─ loadPostWithPlatformStep           │
│  ├─ validatePlatformStep (decrypt)     │
│  ├─ resolvePublishTargetStep           │
│  ├─ extractContentStep                 │
│  ├─ validateCompatibilityStep          │
│  ├─ publishToTargetPlatformsStep       │
│  ├─ mergePublishResultsStep            │
│  └─ updatePostWithResultsStep          │
└─────────────────────────────────────────┘
         ↓
   Platform-Specific Workflows
         ↓
   Facebook/Instagram/Twitter APIs
```

---

## 🔐 Security Enhancement: Token Encryption

### Implementation
- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Management**: Environment variables with rotation support
- **IV**: Unique per encryption (12 bytes)
- **Authentication**: Built-in with GCM mode

### Encrypted Data Structure
```typescript
{
  encrypted: "base64-encrypted-data",
  iv: "base64-initialization-vector",
  authTag: "base64-authentication-tag",
  keyVersion: 1  // For key rotation
}
```

### Token Flow
```
OAuth Callback
    ↓
Plaintext Tokens
    ↓
Encrypt with AES-256-GCM
    ↓
Store Encrypted in Database
    ↓
Workflow Retrieves
    ↓
Decrypt for API Calls
    ↓
Use Token (never logged)
```

### What Gets Encrypted
✅ Access tokens (OAuth 2.0)
✅ Refresh tokens
✅ Page access tokens (Facebook)
✅ OAuth 1.0a secrets (Twitter)
✅ API keys and consumer secrets

### What Stays Plaintext
❌ User IDs, usernames
❌ Platform names
❌ Timestamps
❌ Non-sensitive metadata

---

## 📐 Schema Validation

### Platform-Specific Schemas

Each platform has a validated schema with encrypted tokens:

**Facebook:**
```typescript
{
  platform: "facebook",
  access_token_encrypted: EncryptedData,
  page_access_token_encrypted: EncryptedData,
  user_access_token_encrypted: EncryptedData,
  token_type: "PAGE",
  page_id: string,
  user_id: string,
  authenticated_at: string,
  expires_at: string
}
```

**Instagram:**
```typescript
{
  platform: "instagram",
  access_token_encrypted: EncryptedData,
  token_type: "USER",
  ig_user_id: string,
  page_id: string,
  user_id: string,
  authenticated_at: string
}
```

**Twitter:**
```typescript
{
  platform: "twitter",
  access_token_encrypted: EncryptedData,
  oauth1_credentials_encrypted: {
    access_token: EncryptedData,
    access_token_secret: EncryptedData
  },
  token_type: "USER",
  user_id: string,
  authenticated_at: string
}
```

---

## 🔄 Workflow Steps

### 1. Load Post
- Fetch post with platform relation
- Validate post exists

### 2. Validate Platform
- Check platform exists
- **Decrypt tokens** from api_config
- Validate token expiration
- Check OAuth credentials

### 3. Resolve Publish Target
- Determine: facebook, instagram, both, twitter
- **Smart retry logic**: Only retry failed platforms
- Check previous publish attempts

### 4. Extract Content
- Parse media attachments
- Determine content type (photo, video, text, reel, carousel)
- Extract caption/message

### 5. Validate Compatibility
- Check platform constraints
- Twitter: 280 chars, 4 images max
- Instagram: requires media
- Validate content type support

### 6. Publish to Platforms
- Call appropriate workflow based on target
- Handle errors per platform
- Return results

### 7. Merge Results
- Merge new results with previous attempts
- Handle retry scenarios
- Preserve webhook insights data

### 8. Update Post
- Update post status (posted/failed)
- Set post_url
- Update insights
- Set error_message if failed

---

## 📈 Impact Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Route Handler** | 351 lines | 45 lines | **87% reduction** |
| **Code Duplication** | High | None | **100% eliminated** |
| **Token Security** | Plaintext | AES-256-GCM | **Encrypted at rest** |
| **Testability** | Low | High | **Independently testable** |
| **Type Safety** | Partial | Full | **Runtime + compile-time** |
| **Maintainability** | Low | High | **Clear separation** |
| **Observability** | Limited | Full | **Workflow tracking** |
| **Compliance** | Basic | Full | **GDPR/PCI DSS ready** |

---

## 🚀 Implementation Phases

### Phase 0: Security & External API Foundation ⭐ **START HERE**

**Duration**: 3-4 days

**Tasks**:
1. **Encryption Service** (Day 1)
   - [ ] Create `/src/services/encryption-service.ts`
   - [ ] Generate encryption keys (dev, staging, prod)
   - [ ] Add keys to environment variables
   - [ ] Write unit tests for encrypt/decrypt
   - [ ] Test key rotation support

2. **External API Module** (Day 1-2) ⭐ **NEW**
   - [ ] Rename `social-platforms` → `external-apis`
   - [ ] Create `external-api` model (replaces social-platform)
   - [ ] Create `external-api-connection` model (replaces social-platform-account)
   - [ ] Add `category` field (social, payment, shipping, etc.)
   - [ ] Update service layer with encryption support
   - [ ] Create generic API client

3. **Schema Definition** (Day 2-3)
   - [ ] Create `/src/schemas/external-api-config.ts`
   - [ ] Define Zod schemas with encrypted fields
   - [ ] Support multiple auth types (OAuth2, OAuth1, API Key, Bearer)
   - [ ] Create helper functions (encrypt/decrypt config)
   - [ ] Update OAuth callback to encrypt tokens
   - [ ] Test OAuth flow with encryption

4. **Data Migration** (Day 3-4)
   - [ ] Backup production database
   - [ ] Create migration script (social-platforms → external-apis)
   - [ ] Migrate existing social platforms
   - [ ] Encrypt all credentials
   - [ ] Test migration on staging
   - [ ] Run migration on production
   - [ ] Verify all platforms work

**Deliverables**:
- ✅ Encryption service with tests
- ✅ External APIs module with multi-API support
- ✅ Generic API client for any integration
- ✅ Schemas with encrypted fields
- ✅ All tokens encrypted in database
- ✅ OAuth flow storing encrypted tokens
- ✅ Foundation for future API integrations (Stripe, Twilio, etc.)

---

### Phase 1: Workflow Implementation

**Duration**: 3-4 days

**Tasks**:
1. **Create Workflow Steps** (Day 1-2)
   - [ ] Create `/src/workflows/socials/steps/` directory
   - [ ] Implement all 8 workflow steps
   - [ ] Add decryption in validatePlatformStep
   - [ ] Write unit tests for each step

2. **Create Unified Workflow** (Day 2-3)
   - [ ] Create `publish-social-post-unified.ts`
   - [ ] Wire up all workflow steps
   - [ ] Handle platform branching (Twitter vs FB/IG)
   - [ ] Add error handling and rollback

3. **Integration Tests** (Day 3-4)
   - [ ] Test Facebook publishing
   - [ ] Test Instagram publishing
   - [ ] Test Twitter publishing
   - [ ] Test FBINSTA (both platforms)
   - [ ] Test smart retry logic

**Deliverables**:
- ✅ 8 workflow steps with tests
- ✅ Unified workflow
- ✅ Comprehensive integration tests

---

### Phase 2: Route Refactoring

**Duration**: 1-2 days

**Tasks**:
1. **Update Route Handler** (Day 1)
   - [ ] Refactor `/social-posts/[id]/publish/route.ts`
   - [ ] Replace logic with workflow call
   - [ ] Maintain backward compatibility
   - [ ] Test all publishing scenarios

2. **Testing** (Day 1-2)
   - [ ] Test all platforms
   - [ ] Test smart retry
   - [ ] Test error handling
   - [ ] Verify no plaintext tokens in logs

**Deliverables**:
- ✅ Refactored route handler (45 lines)
- ✅ All tests passing

---

### Phase 3: Documentation & Deployment

**Duration**: 1 day

**Tasks**:
- [ ] Update API documentation
- [ ] Document encryption key management
- [ ] Deploy to staging
- [ ] Monitor for errors
- [ ] Deploy to production
- [ ] Monitor production metrics

**Deliverables**:
- ✅ Updated documentation
- ✅ Production deployment
- ✅ Monitoring in place

---

### Phase 4: Cleanup

**Duration**: 1 day (after grace period)

**Tasks**:
- [ ] Mark `/socials/publish-both` as deprecated
- [ ] Add deprecation warnings
- [ ] Update client code
- [ ] Remove deprecated endpoints

**Deliverables**:
- ✅ Clean codebase
- ✅ No deprecated endpoints

---

## 📚 Documentation Files

### 1. **SOCIAL_POSTS_API_ANALYSIS.md**
**Purpose**: Problem analysis and current state
**Contents**:
- Current API structure
- 5 key issues identified
- Recommended refactoring approach
- Benefits and migration strategy

### 2. **/docs/implementation/security/encryption-service** ⭐ **CRITICAL**
**Purpose**: Complete encryption implementation guide
**Contents**:
- Encryption service implementation
- Key management and rotation
- Helper functions for encrypt/decrypt
- OAuth callback integration
- Workflow usage with decryption
- Migration strategy
- Security best practices
- Testing approach

### 3. **EXTERNAL_API_MANAGEMENT_SYSTEM.md** ⭐ **NEW - ARCHITECTURE**
**Purpose**: External API management system design
**Contents**:
- Rename social-platforms → external-apis
- Database schema for external APIs
- Support for multiple API categories (social, payment, shipping, etc.)
- Generic API client implementation
- Multi-tenancy support
- Usage examples (Facebook, Stripe, Twilio)
- Migration strategy from social-platforms

### 4. **/docs/reference/social-api/config-schema**
**Purpose**: Schema definitions for social platforms
**Contents**:
- Base schema structure
- Platform-specific schemas (FB, IG, FBINSTA, Twitter)
- Zod validation schemas
- Example configs with encrypted fields
- Usage in OAuth callbacks

### 5. **SOCIAL_POSTS_REFACTORING_PLAN.md**
**Purpose**: Step-by-step implementation guide
**Contents**:
- Phase 0: Encryption service (with code)
- Phase 1: Schema definition (with code)
- All 8 workflow steps (with code)
- Unified workflow (with code)
- Route refactoring (with code)
- Testing strategy
- Migration checklist

### 6. **SOCIAL_POSTS_REFACTORING_SUMMARY.md**
**Purpose**: Executive overview
**Contents**:
- Key improvements summary
- Before/after comparison
- Success metrics table
- Implementation phases
- Risk assessment
- Next steps

### 7. **/docs/reference/social-api/refactoring-overview** (This Document)
**Purpose**: Complete overview and quick reference
**Contents**:
- Executive summary
- Current problems
- Proposed architecture
- Security enhancement
- Impact metrics
- Implementation phases
- Documentation index

---

## 🔑 Key Decisions

### 1. **Security First**
- Implement encryption **before** any other changes
- No plaintext tokens in database
- Key rotation support from day one

### 2. **Incremental Implementation**
- Phase 0: Security foundation (no breaking changes)
- Phase 1: Workflow implementation (parallel to existing code)
- Phase 2: Route refactoring (replace existing logic)
- Phase 3: Cleanup (remove old code)

### 3. **Backward Compatibility**
- Maintain existing API contracts
- Support old key versions during rotation
- Gradual migration of existing data

### 4. **Testing Strategy**
- Unit tests for each workflow step
- Integration tests for complete flows
- Test encryption/decryption thoroughly
- Test key rotation scenarios

---

## ⚠️ Critical Requirements

### Environment Variables
```bash
# Required for encryption
ENCRYPTION_KEY=<32-byte-base64-key>
ENCRYPTION_KEY_VERSION=1

# Generate with:
openssl rand -base64 32
```

### Database Backup
- **MUST** backup database before migration
- Test migration on staging first
- Have rollback plan ready

### Key Management
- Store keys securely (AWS Secrets Manager, Vault)
- Never commit keys to version control
- Use different keys per environment
- Document key rotation procedure

---

## ✅ Success Criteria

### Phase 0 Complete When:
- ✅ All tokens encrypted in database
- ✅ OAuth flow stores encrypted tokens
- ✅ Workflows decrypt tokens successfully
- ✅ No plaintext tokens in logs
- ✅ All tests passing

### Phase 1 Complete When:
- ✅ All workflow steps implemented
- ✅ Unified workflow working
- ✅ All platforms publishing successfully
- ✅ Smart retry logic working
- ✅ Integration tests passing

### Phase 2 Complete When:
- ✅ Route handler refactored (45 lines)
- ✅ All publishing scenarios working
- ✅ Error handling working
- ✅ Production deployment successful

### Final Success When:
- ✅ 87% code reduction achieved
- ✅ 100% token encryption
- ✅ Zero security incidents
- ✅ All tests passing
- ✅ Production stable

---

## 🎯 Next Steps

### Immediate Actions:
1. **Review all documentation** (30 minutes)
2. **Generate encryption keys** (5 minutes)
3. **Start Phase 0: Encryption Service** (Day 1)

### This Week:
- Complete Phase 0 (Security & Schema)
- Test encryption thoroughly
- Migrate existing data

### Next Week:
- Complete Phase 1 (Workflow Implementation)
- Complete Phase 2 (Route Refactoring)
- Deploy to production

### Following Week:
- Monitor production
- Complete Phase 3 (Documentation)
- Plan Phase 4 (Cleanup)

---

## 📞 Support & Questions

### If You Need Help:
1. Review the specific documentation file for that phase
2. Check the code examples in SOCIAL_POSTS_REFACTORING_PLAN.md
3. Review /docs/implementation/security/encryption-service for encryption questions
4. Check /docs/reference/social-api/config-schema for schema questions

### Common Questions:

**Q: Why encryption first?**
A: Security is critical. We should never store plaintext tokens, even temporarily.

**Q: Can we skip encryption?**
A: No. This is a security requirement for compliance and best practices.

**Q: What if key rotation fails?**
A: Old keys are kept for decryption. Migration is gradual. No downtime.

**Q: How long will this take?**
A: 7-10 days total. Phase 0 is most critical (2-3 days).

**Q: Is this risky?**
A: Low risk. Incremental implementation, backward compatible, comprehensive tests.

---

## 🎉 Expected Outcomes

After completion, you will have:

1. **Secure System**
   - All tokens encrypted at rest
   - GDPR/PCI DSS compliant
   - Key rotation support

2. **Clean Architecture**
   - 87% less code in routes
   - Clear separation of concerns
   - Workflow-based orchestration

3. **Better Testability**
   - Independently testable steps
   - Comprehensive test coverage
   - Easy to debug

4. **Improved Observability**
   - Workflow execution tracking
   - Clear error messages
   - Easy monitoring

5. **Maintainable Codebase**
   - Easy to add new platforms
   - Simple to modify logic
   - Self-documenting code

---

## 📊 Timeline Summary

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| **Phase 0** | 3-4 days | Encryption service, External APIs module, schemas, migrated data |
| **Phase 1** | 3-4 days | Workflow steps, unified workflow, tests |
| **Phase 2** | 1-2 days | Refactored routes, all tests passing |
| **Phase 3** | 1 day | Documentation, production deployment |
| **Phase 4** | 1 day | Cleanup, deprecated endpoints removed |
| **Total** | **9-12 days** | Complete refactoring with encryption + External API system |

---

## 🚦 Ready to Start?

**Step 1**: Review this document ✅
**Step 2**: Generate encryption keys
**Step 3**: Begin Phase 0 implementation

Let's build a secure, maintainable, and scalable social posts publishing system! 🚀
