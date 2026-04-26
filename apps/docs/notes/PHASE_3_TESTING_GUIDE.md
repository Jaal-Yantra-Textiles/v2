# Phase 3: Testing & Verification Guide

## 🎯 Overview

This guide covers comprehensive testing of the unified publishing workflow to ensure:
- ✅ All platforms work correctly (Facebook, Instagram, Twitter)
- ✅ Smart retry logic functions as expected
- ✅ Content validation works properly
- ✅ Security is maintained (encrypted tokens)
- ✅ No regressions from refactoring

---

## 📋 Test Plan

### Phase 3.1: Integration Tests ✅
**File:** `/integration-tests/http/socials/unified-publish-workflow.spec.ts`

**Test Coverage:**
1. **Facebook Publishing**
   - ✅ Successful publish
   - ✅ Missing page_id validation
   - ✅ Override page_id support

2. **Instagram Publishing**
   - ✅ Successful publish
   - ✅ Text-only post rejection
   - ✅ Override ig_user_id support

3. **Twitter Publishing**
   - ✅ Successful publish
   - ✅ 280 character limit
   - ✅ 4 image maximum
   - ✅ No mixing images + video

4. **FBINSTA (Both Platforms)**
   - ✅ Publish to both successfully
   - ✅ Results for both platforms

5. **Smart Retry Logic**
   - ✅ Retry only Instagram when Facebook succeeded
   - ✅ Retry only Facebook when Instagram succeeded
   - ✅ Preserve successful publishes

6. **Security & Encryption**
   - ✅ Tokens encrypted in database
   - ✅ Tokens decrypted in workflow
   - ✅ No plaintext in logs

---

## 🧪 Running Tests

### Run All Integration Tests
```bash
yarn test:integration:http
```

### Run Specific Test File
```bash
yarn test:integration:http ./integration-tests/http/socials/unified-publish-workflow.spec.ts
```

### Run Specific Test Suite
```bash
yarn test:integration:http -t "Unified Publishing Workflow"
```

### Run Specific Test Case
```bash
yarn test:integration:http -t "should publish to Facebook successfully"
```

---

## 📊 Test Scenarios

### Scenario 1: Facebook-Only Post
**Setup:**
- Platform: Facebook
- Content: Single image + caption
- Metadata: `page_id`, `publish_target: "facebook"`

**Expected:**
- ✅ Post published to Facebook
- ✅ `results.facebook` contains post ID
- ✅ Post status = "posted"
- ✅ Post URL set to Facebook permalink

---

### Scenario 2: Instagram-Only Post
**Setup:**
- Platform: Instagram
- Content: Single image + caption
- Metadata: `ig_user_id`, `publish_target: "instagram"`

**Expected:**
- ✅ Post published to Instagram
- ✅ `results.instagram` contains media ID
- ✅ Post status = "posted"
- ✅ Instagram permalink in insights

---

### Scenario 3: Twitter Post
**Setup:**
- Platform: Twitter
- Content: Text (< 280 chars)
- Credentials: OAuth1 credentials

**Expected:**
- ✅ Tweet published
- ✅ `results.twitter` contains tweet data
- ✅ Post status = "posted"

---

### Scenario 4: FBINSTA (Both Platforms)
**Setup:**
- Platform: Facebook & Instagram
- Content: Single image + caption
- Metadata: `page_id`, `ig_user_id`, `publish_target: "both"`

**Expected:**
- ✅ Published to both platforms
- ✅ `results.facebook` and `results.instagram` both present
- ✅ Post status = "posted" (if both succeed)
- ✅ Both permalinks in insights

---

### Scenario 5: Smart Retry - Instagram Failed
**Setup:**
- Platform: FBINSTA
- Previous attempt: Facebook ✅, Instagram ❌
- Metadata: `publish_target: "both"`

**Expected:**
- ✅ Only publishes to Instagram (smart retry)
- ✅ Preserves Facebook success from previous attempt
- ✅ `retry_info.is_retry = true`
- ✅ `retry_info.retried_platform = "instagram"`

---

### Scenario 6: Smart Retry - Facebook Failed
**Setup:**
- Platform: FBINSTA
- Previous attempt: Facebook ❌, Instagram ✅
- Metadata: `publish_target: "both"`

**Expected:**
- ✅ Only publishes to Facebook (smart retry)
- ✅ Preserves Instagram success from previous attempt
- ✅ `retry_info.is_retry = true`
- ✅ `retry_info.retried_platform = "facebook"`

---

### Scenario 7: Content Validation - Text-Only Instagram
**Setup:**
- Platform: Instagram
- Content: Caption only, no media
- Metadata: `ig_user_id`, `publish_target: "instagram"`

**Expected:**
- ❌ Validation error
- ❌ Error message: "Text-only posts are not supported on Instagram"
- ❌ Post status remains "draft"

---

### Scenario 8: Content Validation - Twitter Character Limit
**Setup:**
- Platform: Twitter
- Content: 281 characters
- Credentials: OAuth1

**Expected:**
- ❌ Validation error
- ❌ Error message: "Tweet text exceeds 280 characters"
- ❌ Post status remains "draft"

---

### Scenario 9: Content Validation - Twitter Image Limit
**Setup:**
- Platform: Twitter
- Content: 5 images
- Credentials: OAuth1

**Expected:**
- ❌ Validation error
- ❌ Error message: "Twitter supports maximum 4 images"
- ❌ Post status remains "draft"

---

### Scenario 10: Missing Credentials
**Setup:**
- Platform: Facebook (no access_token)
- Content: Single image + caption

**Expected:**
- ❌ Validation error
- ❌ Error message: "No access token found"
- ❌ Post status remains "draft"

---

## 🔒 Security Verification

### Test 1: Token Encryption in Database
**Steps:**
1. Create platform with plaintext token
2. Fetch platform from database
3. Verify `api_config.access_token_encrypted` exists
4. Verify encrypted object has: `encrypted`, `iv`, `authTag`
5. Verify plaintext token is NOT in database

**Expected:**
```json
{
  "api_config": {
    "access_token_encrypted": {
      "encrypted": "...",
      "iv": "...",
      "authTag": "...",
      "keyVersion": 1
    }
  }
}
```

---

### Test 2: Token Decryption in Workflow
**Steps:**
1. Create platform with encrypted token
2. Publish post
3. Verify workflow decrypts token successfully
4. Verify publish succeeds

**Expected:**
- ✅ Workflow decrypts token
- ✅ Publish succeeds
- ✅ No errors related to encryption

---

### Test 3: No Plaintext in Logs
**Steps:**
1. Enable debug logging
2. Publish post
3. Check logs for plaintext tokens

**Expected:**
- ✅ No plaintext tokens in logs
- ✅ Only encrypted data or "[REDACTED]" in logs

---

## 📈 Performance Testing

### Test 1: Single Platform Publish Time
**Metric:** Time to publish to one platform
**Target:** < 2 seconds
**Steps:**
1. Create post
2. Measure time to publish
3. Verify under 2 seconds

---

### Test 2: Both Platforms Publish Time
**Metric:** Time to publish to both platforms
**Target:** < 4 seconds
**Steps:**
1. Create FBINSTA post
2. Measure time to publish to both
3. Verify under 4 seconds

---

### Test 3: Retry Performance
**Metric:** Time to retry failed platform
**Target:** < 2 seconds
**Steps:**
1. Create post with previous failed attempt
2. Measure retry time
3. Verify under 2 seconds

---

## ✅ Success Criteria

### Must Pass:
- ✅ All integration tests pass
- ✅ All platforms publish successfully
- ✅ Smart retry works correctly
- ✅ Content validation works
- ✅ Tokens are encrypted in DB
- ✅ No plaintext tokens in logs
- ✅ Performance targets met

### Nice to Have:
- ✅ Test coverage > 80%
- ✅ No console errors
- ✅ Clean logs

---

## 🐛 Debugging Failed Tests

### Test Fails: "Post not found"
**Cause:** Post not created properly in beforeEach
**Fix:** Check post creation response, verify ID

### Test Fails: "Platform not found"
**Cause:** Platform not created properly
**Fix:** Check platform creation response, verify ID

### Test Fails: "No access token"
**Cause:** Token not encrypted properly
**Fix:** Check encryption service, verify token helpers

### Test Fails: "Validation error"
**Cause:** Content doesn't meet platform requirements
**Fix:** Check content type, media attachments, caption length

### Test Fails: "Workflow error"
**Cause:** Step failing in workflow
**Fix:** Check workflow logs, identify failing step

---

## 📝 Test Execution Checklist

- [ ] Run all integration tests
- [ ] Verify all tests pass
- [ ] Check test coverage report
- [ ] Review console logs for errors
- [ ] Verify no plaintext tokens in logs
- [ ] Test each platform individually
- [ ] Test FBINSTA (both platforms)
- [ ] Test smart retry scenarios
- [ ] Test content validation
- [ ] Test security (encryption)
- [ ] Measure performance
- [ ] Document any issues found
- [ ] Fix any failing tests
- [ ] Re-run tests after fixes
- [ ] Get final approval

---

## 🚀 Next Steps After Testing

1. **All Tests Pass:**
   - ✅ Mark Phase 3 complete
   - ✅ Move to Phase 4: Documentation & Deployment

2. **Some Tests Fail:**
   - ❌ Debug and fix issues
   - ❌ Re-run tests
   - ❌ Repeat until all pass

3. **Performance Issues:**
   - ⚠️ Optimize slow steps
   - ⚠️ Add caching if needed
   - ⚠️ Re-test performance

---

## 📊 Test Results Template

```markdown
# Test Results - Phase 3

**Date:** [Date]
**Tester:** [Name]
**Environment:** [Dev/Staging/Prod]

## Summary
- Total Tests: X
- Passed: X
- Failed: X
- Skipped: X
- Coverage: X%

## Platform Tests
- [ ] Facebook: PASS/FAIL
- [ ] Instagram: PASS/FAIL
- [ ] Twitter: PASS/FAIL
- [ ] FBINSTA: PASS/FAIL

## Smart Retry Tests
- [ ] Retry Instagram: PASS/FAIL
- [ ] Retry Facebook: PASS/FAIL
- [ ] Preserve Success: PASS/FAIL

## Validation Tests
- [ ] Text-only Instagram: PASS/FAIL
- [ ] Twitter Char Limit: PASS/FAIL
- [ ] Twitter Image Limit: PASS/FAIL

## Security Tests
- [ ] Token Encryption: PASS/FAIL
- [ ] Token Decryption: PASS/FAIL
- [ ] No Plaintext Logs: PASS/FAIL

## Performance Tests
- [ ] Single Platform: X seconds (Target: < 2s)
- [ ] Both Platforms: X seconds (Target: < 4s)
- [ ] Retry: X seconds (Target: < 2s)

## Issues Found
1. [Issue description]
2. [Issue description]

## Conclusion
[PASS/FAIL] - [Summary]
```

---

## 🎯 Ready to Test!

Run the tests and verify everything works! 🚀
