---
title: "Smart Retry Publishing for Social Media Posts"
sidebar_label: "Smart Retry"
sidebar_position: 3
---

# Smart Retry Publishing for Social Media Posts

## 🎯 Overview

The publishing system now includes **intelligent retry logic** that automatically detects which platform failed and only retries that specific platform, preserving successful results from previous attempts.

---

## 🔍 How It Works

### **Scenario: Publishing to Both Platforms**

When you publish to both Facebook and Instagram (`publish_target: "both"`):

1. **First Attempt:**
   - ✅ Instagram: Success
   - ❌ Facebook: Failed (e.g., invalid image URL)
   
2. **Retry (Automatic):**
   - System detects Facebook failed
   - **Only retries Facebook** (skips Instagram)
   - Preserves Instagram's successful result

3. **Final Result:**
   - ✅ Instagram: Original successful post
   - ✅ Facebook: New successful post
   - Status: `posted` ✅

---

## 📊 Detection Logic

The system examines `insights.publish_results` to determine previous attempts:

```typescript
// Check previous results
const previousResults = post.insights?.publish_results || []

// Detect failures
const facebookPreviouslyFailed = previousResults.some(
  r => r.platform === "facebook" && !r.success
)
const instagramPreviouslyFailed = previousResults.some(
  r => r.platform === "instagram" && !r.success
)

// Detect successes
const facebookPreviouslySucceeded = previousResults.some(
  r => r.platform === "facebook" && r.success
)
const instagramPreviouslySucceeded = previousResults.some(
  r => r.platform === "instagram" && r.success
)
```

---

## 🔄 Retry Behavior

### **Case 1: Facebook Failed, Instagram Succeeded**

**Original Request:**
```json
{
  "publish_target": "both"
}
```

**Smart Retry:**
```typescript
if (facebookPreviouslyFailed && instagramPreviouslySucceeded) {
  publishTarget = "facebook"  // Only retry Facebook
  console.log("🔄 Smart retry: Publishing only to Facebook")
}
```

**Result:**
- Only publishes to Facebook
- Instagram result preserved from previous attempt
- Merged results show both platforms

---

### **Case 2: Instagram Failed, Facebook Succeeded**

**Original Request:**
```json
{
  "publish_target": "both"
}
```

**Smart Retry:**
```typescript
if (instagramPreviouslyFailed && facebookPreviouslySucceeded) {
  publishTarget = "instagram"  // Only retry Instagram
  console.log("🔄 Smart retry: Publishing only to Instagram")
}
```

**Result:**
- Only publishes to Instagram
- Facebook result preserved from previous attempt
- Merged results show both platforms

---

### **Case 3: Both Failed**

**Behavior:**
- Retries both platforms
- Replaces both previous results

---

### **Case 4: Both Succeeded**

**Behavior:**
- Still allows republishing (e.g., for testing)
- Replaces both previous results with new ones

---

## 📝 Data Structure

### **Insights After Failed Attempt**

```json
{
  "insights": {
    "publish_results": [
      {
        "platform": "facebook",
        "success": false,
        "error": "Facebook photo upload failed: 400 - Missing or invalid image file"
      },
      {
        "platform": "instagram",
        "success": true,
        "postId": "18107758234627017",
        "permalink": "https://www.instagram.com/p/DRJ1nlKDgY9/"
      }
    ],
    "published_at": "2025-11-17T10:10:13.151Z",
    "instagram_media_id": "18107758234627017",
    "instagram_permalink": "https://www.instagram.com/p/DRJ1nlKDgY9/"
  },
  "status": "failed",
  "error_message": "facebook: Facebook photo upload failed: 400 - Missing or invalid image file"
}
```

### **Insights After Successful Retry**

```json
{
  "insights": {
    "publish_results": [
      {
        "platform": "facebook",
        "success": true,
        "postId": "747917475065823_122104567890123"
      },
      {
        "platform": "instagram",
        "success": true,
        "postId": "18107758234627017",
        "permalink": "https://www.instagram.com/p/DRJ1nlKDgY9/"
      }
    ],
    "published_at": "2025-11-17T10:10:13.151Z",
    "last_retry_at": "2025-11-17T10:15:30.456Z",
    "facebook_post_id": "747917475065823_122104567890123",
    "instagram_media_id": "18107758234627017",
    "instagram_permalink": "https://www.instagram.com/p/DRJ1nlKDgY9/"
  },
  "status": "posted",
  "error_message": null,
  "post_url": "https://www.facebook.com/747917475065823_122104567890123"
}
```

---

## 🔧 Implementation Details

### **Result Merging Logic**

```typescript
// Merge new results with previous results
const mergedResults = [...previousResults]

publishResults.forEach((newResult) => {
  const existingIndex = mergedResults.findIndex(
    r => r.platform === newResult.platform
  )
  
  if (existingIndex >= 0) {
    // Replace previous result for this platform
    mergedResults[existingIndex] = newResult
  } else {
    // Add new result
    mergedResults.push(newResult)
  }
})
```

### **Status Determination**

```typescript
// Check if ALL platforms succeeded
const allPlatformsSucceeded = mergedResults.every(r => r.success)

// Update post status
status: allPlatformsSucceeded ? "posted" : "failed"
```

---

## 📡 API Response

### **First Attempt (Partial Failure)**

```json
{
  "success": false,
  "post": {
    "id": "01KA8MNE2DT1E31F8Z3TJHF96E",
    "status": "failed",
    "error_message": "facebook: Facebook photo upload failed: 400 - Missing or invalid image file"
  },
  "results": {
    "facebook": {
      "platform": "facebook",
      "success": false,
      "error": "Facebook photo upload failed: 400 - Missing or invalid image file"
    },
    "instagram": {
      "platform": "instagram",
      "success": true,
      "postId": "18107758234627017",
      "permalink": "https://www.instagram.com/p/DRJ1nlKDgY9/"
    }
  }
}
```

### **Retry Attempt (Success)**

```json
{
  "success": true,
  "post": {
    "id": "01KA8MNE2DT1E31F8Z3TJHF96E",
    "status": "posted",
    "error_message": null
  },
  "results": {
    "facebook": {
      "platform": "facebook",
      "success": true,
      "postId": "747917475065823_122104567890123"
    },
    "instagram": {
      "platform": "instagram",
      "success": true,
      "postId": "18107758234627017",
      "permalink": "https://www.instagram.com/p/DRJ1nlKDgY9/"
    }
  },
  "retry_info": {
    "is_retry": true,
    "previous_attempts": 2,
    "retried_platform": "facebook"
  }
}
```

---

## 🎨 UI Behavior

### **Post Detail View**

**After Failed Attempt:**
```
┌─────────────────────────────────────────┐
│ Social Post Detail                      │
├─────────────────────────────────────────┤
│ Status: ❌ Failed                       │
│                                         │
│ Error: facebook: Missing or invalid     │
│        image file                       │
│                                         │
│ ✅ Instagram: Published                 │
│ https://www.instagram.com/p/DRJ1nlKDgY9/│
│                                         │
│ [📘 + 📷 Retry Publishing]              │
│                                         │
│ Note: Will only retry Facebook          │
└─────────────────────────────────────────┘
```

**After Successful Retry:**
```
┌─────────────────────────────────────────┐
│ Social Post Detail                      │
├─────────────────────────────────────────┤
│ Status: ✅ Posted                       │
│                                         │
│ Facebook Post:                          │
│ https://www.facebook.com/747917...      │
│                                         │
│ Instagram Post:                         │
│ https://www.instagram.com/p/DRJ1nlKDgY9/│
│                                         │
│ 🔄 Retried: Facebook (1 retry)          │
└─────────────────────────────────────────┘
```

---

## 🚀 Usage Examples

### **Example 1: Fix Image URL and Retry**

**Problem:** Facebook failed due to space in filename

**Steps:**
1. Fix the image URL in your CDN (or the fix is already in code)
2. Click "Retry Publishing" button
3. System automatically retries only Facebook
4. Instagram result preserved

**Result:** Both platforms now published ✅

---

### **Example 2: Retry After Token Refresh**

**Problem:** Instagram failed due to expired token

**Steps:**
1. Re-authenticate the FBINSTA platform
2. Click "Retry Publishing" button
3. System automatically retries only Instagram
4. Facebook result preserved

**Result:** Both platforms now published ✅

---

## 🔒 Safety Features

### **1. Idempotency**
- Multiple retries won't create duplicate posts
- Each platform's result is replaced, not duplicated

### **2. Preservation**
- Successful results are never lost
- Only failed platforms are retried

### **3. Transparency**
- `retry_info` shows retry history
- `last_retry_at` timestamp tracks retries
- Console logs show which platform is being retried

### **4. Error Tracking**
- Error messages preserved for failed platforms
- Success messages preserved for successful platforms

---

## 📊 Monitoring

### **Console Logs**

```bash
# First attempt
Publishing to both Facebook and Instagram...

# Retry detected
🔄 Smart retry: Publishing only to Facebook (Instagram already succeeded)

# Success
✅ Facebook published successfully
✅ Post status updated to: posted
```

### **Insights Tracking**

```typescript
// Check retry history
const retryCount = post.insights?.publish_results?.length || 0
const lastRetry = post.insights?.last_retry_at

console.log(`Post has ${retryCount} publish attempts`)
console.log(`Last retry: ${lastRetry}`)
```

---

## 🎯 Benefits

### **1. Cost Efficiency**
- Don't waste API calls republishing successful platforms
- Only retry what failed

### **2. User Experience**
- Automatic detection - no manual platform selection needed
- Preserves successful posts - no duplicate content
- Clear feedback on what was retried

### **3. Reliability**
- Handles partial failures gracefully
- Maintains data integrity
- Prevents duplicate posts

### **4. Debugging**
- Clear error messages per platform
- Retry history preserved
- Easy to identify which platform is problematic

---

## 🔧 Technical Notes

### **Workflow Integration**

The smart retry works with the existing `publishToBothPlatformsUnifiedWorkflow`:

```typescript
const { result } = await publishToBothPlatformsUnifiedWorkflow(req.scope).run({
  input: {
    pageId: pageId || "",
    igUserId: igUserId || "",
    userAccessToken,
    publishTarget,  // ← Automatically adjusted for retry
    content: { ... }
  }
})
```

### **Backward Compatibility**

- Works with existing posts (no migration needed)
- Posts without previous results behave normally
- Gracefully handles missing `publish_results` field

---

## 📝 Summary

**Before Smart Retry:**
- ❌ Had to manually republish to both platforms
- ❌ Created duplicate posts on successful platform
- ❌ Wasted API calls

**After Smart Retry:**
- ✅ Automatically detects failed platform
- ✅ Only retries what failed
- ✅ Preserves successful results
- ✅ Clear retry tracking

**Result:** Efficient, reliable, and user-friendly retry system! 🎉
