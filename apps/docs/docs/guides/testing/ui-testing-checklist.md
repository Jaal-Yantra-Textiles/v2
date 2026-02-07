---
title: "UI Testing Checklist - Social Posts Publishing"
sidebar_label: "UI Testing Checklist"
sidebar_position: 1
---

# UI Testing Checklist - Social Posts Publishing

## 🎯 Testing Objective

Manually test the unified social post publishing workflow through the UI to identify what's working and what needs improvement.

---

## 🧪 Test Scenarios

### 1. Platform Management

#### Test 1.1: Create Social Platform
- [ ] Navigate to Social Platforms
- [ ] Click "Create Platform"
- [ ] Fill in platform details:
  - Name: "Test Facebook"
  - Category: "social"
  - Auth Type: "oauth2"
- [ ] Save platform
- [ ] **Expected**: Platform created successfully
- [ ] **Check**: Verify in database that tokens are NOT encrypted yet (plaintext)
- [ ] **Check**: Check server logs for encryption subscriber activity

#### Test 1.2: OAuth Authentication
- [ ] Click "Authenticate" on platform
- [ ] Complete Facebook OAuth flow
- [ ] **Expected**: Redirected back with success message
- [ ] **Expected**: Platform shows "Connected" status
- [ ] **Check**: Verify tokens are encrypted in database
- [ ] **Check**: Check logs for `[Encryption Subscriber] ✅ Platform ... credentials encrypted`

#### Test 1.3: Platform Update
- [ ] Edit platform details
- [ ] Update name or description
- [ ] Save changes
- [ ] **Expected**: Changes saved successfully
- [ ] **Check**: Tokens remain encrypted after update

---

### 2. Post Creation

#### Test 2.1: Create Facebook Post
- [ ] Navigate to Social Posts
- [ ] Click "Create Post"
- [ ] Fill in details:
  - Name: "Test Facebook Post"
  - Platform: Select Facebook platform
  - Caption: "Hello Facebook! #test #socialmedia"
  - Media: Upload/select an image
  - Metadata: Add `page_id`
- [ ] Save post
- [ ] **Expected**: Post created with status "draft"
- [ ] **Check**: Verify `media_attachments` is object format, not array
- [ ] **Check**: Check logs for hashtag extraction

#### Test 2.2: Create Instagram Post
- [ ] Create new post
- [ ] Select Instagram platform
- [ ] Add caption with hashtags: "#instagram #test"
- [ ] Add image (required for Instagram)
- [ ] Add `ig_user_id` in metadata
- [ ] Save post
- [ ] **Expected**: Post created successfully
- [ ] **Check**: Validation prevents text-only posts

#### Test 2.3: Create FBINSTA Post
- [ ] Create new post
- [ ] Select FBINSTA platform
- [ ] Add caption: "Posting to both! #facebook #instagram"
- [ ] Add image
- [ ] Add both `page_id` and `ig_user_id` in metadata
- [ ] Save post
- [ ] **Expected**: Post created successfully

#### Test 2.4: Create Twitter Post
- [ ] Create new post
- [ ] Select Twitter platform
- [ ] Add caption (max 280 chars): "Testing Twitter! #test"
- [ ] Optional: Add image (max 4)
- [ ] Save post
- [ ] **Expected**: Post created successfully
- [ ] **Check**: Character count validation

---

### 3. Post Publishing

#### Test 3.1: Publish to Facebook
- [ ] Open Facebook post from Test 2.1
- [ ] Click "Publish" button
- [ ] **Expected**: Publishing starts
- [ ] **Expected**: Either success or "Invalid OAuth token" error
- [ ] **Check**: Post status updates to "published" or "failed"
- [ ] **Check**: `insights.facebook_post_id` populated (if real token)
- [ ] **Check**: Error message is clear (if fake token)
- [ ] **Check**: Logs show all 11 workflow steps executing

#### Test 3.2: Publish to Instagram
- [ ] Open Instagram post from Test 2.2
- [ ] Click "Publish"
- [ ] **Expected**: Publishing starts
- [ ] **Expected**: Either success or token error
- [ ] **Check**: `insights.instagram_media_id` populated (if real token)
- [ ] **Check**: Two-step process (container creation → publish)

#### Test 3.3: Publish to FBINSTA
- [ ] Open FBINSTA post from Test 2.3
- [ ] Click "Publish to Both Platforms"
- [ ] **Expected**: Publishing to both platforms
- [ ] **Expected**: Results for both Facebook and Instagram
- [ ] **Check**: `insights.publish_results` contains both platforms
- [ ] **Check**: Both `facebook_post_id` and `instagram_media_id` populated

#### Test 3.4: Publish to Twitter
- [ ] Open Twitter post
- [ ] Click "Publish"
- [ ] **Expected**: Publishing starts
- [ ] **Expected**: Either success or OAuth error
- [ ] **Check**: `insights.twitter_tweet_id` populated (if real token)

---

### 4. Smart Retry

#### Test 4.1: FBINSTA Partial Failure
- [ ] Create FBINSTA post
- [ ] Publish (assume Facebook succeeds, Instagram fails)
- [ ] **Expected**: Post status "failed"
- [ ] **Expected**: `publish_results` shows Facebook success, Instagram failure
- [ ] Click "Publish" again (retry)
- [ ] **Expected**: Only Instagram is retried
- [ ] **Expected**: Facebook result preserved from first attempt
- [ ] **Check**: Logs show `[Smart Retry] Publishing only to Instagram`

#### Test 4.2: Single Platform Retry
- [ ] Create Facebook post
- [ ] Publish (fails)
- [ ] Fix issue (e.g., add page_id)
- [ ] Publish again
- [ ] **Expected**: Full retry
- [ ] **Check**: Previous results replaced

---

### 5. Validation

#### Test 5.1: Missing page_id
- [ ] Create Facebook post
- [ ] Don't add `page_id` in metadata
- [ ] Click "Publish"
- [ ] **Expected**: Error "No Facebook page_id found"
- [ ] **Check**: Clear error message in UI

#### Test 5.2: Missing ig_user_id
- [ ] Create Instagram post
- [ ] Don't add `ig_user_id`
- [ ] Click "Publish"
- [ ] **Expected**: Error about missing ig_user_id
- [ ] **Check**: Validation happens before API call

#### Test 5.3: Instagram Text-Only
- [ ] Create Instagram post
- [ ] Add caption only, no media
- [ ] Click "Publish"
- [ ] **Expected**: Error "Text-only posts not supported on Instagram"
- [ ] **Check**: Validation in Step 8

#### Test 5.4: Twitter Character Limit
- [ ] Create Twitter post
- [ ] Add caption > 280 characters
- [ ] Click "Publish"
- [ ] **Expected**: Error about character limit
- [ ] **Check**: Validation before API call

#### Test 5.5: Media Attachments Format
- [ ] Try to create post with array format media_attachments
- [ ] **Expected**: Validation error
- [ ] **Expected**: Error message mentions "Expected type: 'object'"

---

### 6. Post Details View

#### Test 6.1: View Published Post
- [ ] Open a published post
- [ ] **Check**: Status shows "published"
- [ ] **Check**: `posted_at` timestamp displayed
- [ ] **Check**: Platform-specific IDs shown (facebook_post_id, etc.)
- [ ] **Check**: Publish results displayed
- [ ] **Check**: Links to published posts (if available)

#### Test 6.2: View Failed Post
- [ ] Open a failed post
- [ ] **Check**: Status shows "failed"
- [ ] **Check**: Error message displayed
- [ ] **Check**: Retry button available
- [ ] **Check**: Previous results shown (if partial failure)

---

### 7. Deprecated Endpoint

#### Test 7.1: Old Endpoint Warning
- [ ] Use old `/admin/socials/publish-both` endpoint (via API)
- [ ] **Expected**: Works but shows deprecation warning
- [ ] **Check**: Response includes `_deprecation` field
- [ ] **Check**: Headers include `Deprecation: true`
- [ ] **Check**: Server logs show deprecation warning

---

### 8. Error Handling

#### Test 8.1: Invalid Token
- [ ] Create platform with fake token
- [ ] Create and publish post
- [ ] **Expected**: Clear error message about invalid token
- [ ] **Expected**: Post status "failed"
- [ ] **Check**: Error doesn't expose sensitive data

#### Test 8.2: Network Error
- [ ] Disconnect internet
- [ ] Try to publish post
- [ ] **Expected**: Network error message
- [ ] **Expected**: Post remains in previous state

#### Test 8.3: Missing Platform
- [ ] Create post
- [ ] Delete platform
- [ ] Try to publish post
- [ ] **Expected**: Error "Platform not found"

---

## 📊 Test Results Template

### Test Session Info
- **Date**: ___________
- **Tester**: ___________
- **Environment**: Development / Staging / Production
- **Browser**: ___________

### Results Summary

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| 1.1 | Create Platform | ✅ / ❌ | |
| 1.2 | OAuth Auth | ✅ / ❌ | |
| 1.3 | Platform Update | ✅ / ❌ | |
| 2.1 | Create FB Post | ✅ / ❌ | |
| 2.2 | Create IG Post | ✅ / ❌ | |
| 2.3 | Create FBINSTA Post | ✅ / ❌ | |
| 2.4 | Create Twitter Post | ✅ / ❌ | |
| 3.1 | Publish to FB | ✅ / ❌ | |
| 3.2 | Publish to IG | ✅ / ❌ | |
| 3.3 | Publish to FBINSTA | ✅ / ❌ | |
| 3.4 | Publish to Twitter | ✅ / ❌ | |
| 4.1 | FBINSTA Retry | ✅ / ❌ | |
| 4.2 | Single Platform Retry | ✅ / ❌ | |
| 5.1 | Missing page_id | ✅ / ❌ | |
| 5.2 | Missing ig_user_id | ✅ / ❌ | |
| 5.3 | IG Text-Only | ✅ / ❌ | |
| 5.4 | Twitter Char Limit | ✅ / ❌ | |
| 5.5 | Media Format | ✅ / ❌ | |
| 6.1 | View Published | ✅ / ❌ | |
| 6.2 | View Failed | ✅ / ❌ | |
| 7.1 | Deprecated Endpoint | ✅ / ❌ | |
| 8.1 | Invalid Token | ✅ / ❌ | |
| 8.2 | Network Error | ✅ / ❌ | |
| 8.3 | Missing Platform | ✅ / ❌ | |

---

## 🐛 Bugs Found

### Bug Template
```
**Bug ID**: BUG-001
**Test**: Test 2.1 - Create Facebook Post
**Severity**: High / Medium / Low
**Description**: Clear description of the issue
**Steps to Reproduce**:
1. Step 1
2. Step 2
3. Step 3
**Expected**: What should happen
**Actual**: What actually happened
**Screenshots**: (if applicable)
**Logs**: Relevant log entries
**Priority**: P0 (Critical) / P1 (High) / P2 (Medium) / P3 (Low)
```

---

## 💡 UI Improvements Needed

### Improvement Template
```
**ID**: UI-001
**Area**: Social Posts / Platforms / Publishing
**Current**: Current behavior/UI
**Proposed**: Suggested improvement
**Benefit**: Why this would help
**Priority**: High / Medium / Low
```

---

## 🎯 Success Criteria

### Must Work ✅
- [ ] Platform creation and OAuth
- [ ] Token encryption (automatic via subscriber)
- [ ] Post creation for all platforms
- [ ] Publishing to single platforms (FB, IG, Twitter)
- [ ] Publishing to FBINSTA
- [ ] Smart retry logic
- [ ] Validation errors are clear
- [ ] Post status updates correctly

### Should Work ✅
- [ ] Hashtag extraction
- [ ] Mention extraction
- [ ] Error messages are user-friendly
- [ ] Logs are structured and helpful
- [ ] Deprecated endpoint shows warnings

### Nice to Have ✅
- [ ] Performance is acceptable
- [ ] UI is intuitive
- [ ] No console errors in browser
- [ ] Mobile responsive (if applicable)

---

## 📝 Notes Section

Use this space for additional observations, suggestions, or questions that arise during testing.

---

**Testing Started**: ___________  
**Testing Completed**: ___________  
**Overall Status**: ⏳ In Progress / ✅ Complete / ❌ Blocked
