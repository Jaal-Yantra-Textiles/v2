# Migration Guide: Old Endpoint → Unified Workflow

## 🚨 Deprecation Notice

The `/admin/socials/publish-both` endpoint is **deprecated** and will be removed in 90 days.

**Sunset Date**: 90 days from deployment  
**Alternative**: `POST /admin/social-posts/:id/publish`

---

## 📊 What's Changing

### Old Endpoint (Deprecated)
```
POST /admin/socials/publish-both
Body: { "post_id": "post_123" }
```

### New Endpoint (Recommended)
```
POST /admin/social-posts/:id/publish
Body: { "override_page_id": "...", "override_ig_user_id": "..." }
```

---

## 🔄 Migration Steps

### Step 1: Update API Calls

**Before**:
```typescript
// ❌ Old way (deprecated)
const response = await fetch('/admin/socials/publish-both', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    post_id: 'post_123'
  })
})
```

**After**:
```typescript
// ✅ New way (recommended)
const response = await fetch(`/admin/social-posts/${postId}/publish`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    override_page_id: '...',  // Optional
    override_ig_user_id: '...' // Optional
  })
})
```

### Step 2: Update Response Handling

The response structure is similar but slightly different:

**Old Response**:
```json
{
  "success": true,
  "post": { ... },
  "results": {
    "facebook": { "success": true, "post_id": "..." },
    "instagram": { "success": true, "media_id": "..." }
  }
}
```

**New Response**:
```json
{
  "success": true,
  "post": { ... },
  "results": {
    "facebook": { "success": true, "post_id": "..." },
    "instagram": { "success": true, "media_id": "..." }
  },
  "retry_info": {
    "is_retry": false,
    "retried_platforms": []
  }
}
```

**Changes**:
- ✅ Added `retry_info` field
- ✅ Same `results` structure
- ✅ Same `success` and `post` fields

---

## 💡 Benefits of New Endpoint

1. **Unified Publishing** - Works for Facebook, Instagram, Twitter, and FBINSTA
2. **Smart Retry** - Only retries failed platforms
3. **Better Validation** - Content compatibility checks
4. **Cleaner Architecture** - Modular workflow steps
5. **Better Error Messages** - More descriptive errors

---

## 🔍 Detecting Deprecated Endpoint Usage

The deprecated endpoint now returns:

**Headers**:
```
Deprecation: true
Sunset: <date 90 days from now>
Link: </admin/social-posts/:id/publish>; rel="alternate"
```

**Response Body**:
```json
{
  "success": true,
  "post": { ... },
  "results": { ... },
  "_deprecation": {
    "message": "This endpoint is deprecated. Use POST /admin/social-posts/:id/publish instead.",
    "sunset_date": "2025-02-17T14:00:00.000Z",
    "alternative": "POST /admin/social-posts/:id/publish"
  }
}
```

**Console Warning**:
```
[DEPRECATED] POST /admin/socials/publish-both is deprecated. 
Use POST /admin/social-posts/:id/publish instead. 
This endpoint will be removed in a future version.
```

---

## 📝 Code Examples

### Example 1: Simple Migration

**Before**:
```typescript
async function publishPost(postId: string) {
  const response = await api.post('/admin/socials/publish-both', {
    post_id: postId
  })
  return response.data
}
```

**After**:
```typescript
async function publishPost(postId: string) {
  const response = await api.post(`/admin/social-posts/${postId}/publish`, {})
  return response.data
}
```

### Example 2: With Overrides

**Before**:
```typescript
// Not supported in old endpoint
```

**After**:
```typescript
async function publishPost(postId: string, pageId?: string, igUserId?: string) {
  const response = await api.post(`/admin/social-posts/${postId}/publish`, {
    override_page_id: pageId,
    override_ig_user_id: igUserId
  })
  return response.data
}
```

### Example 3: Error Handling

**Before**:
```typescript
try {
  const result = await api.post('/admin/socials/publish-both', { post_id })
  if (!result.success) {
    console.error('Publishing failed:', result.post.error_message)
  }
} catch (error) {
  console.error('API error:', error.message)
}
```

**After**:
```typescript
try {
  const result = await api.post(`/admin/social-posts/${postId}/publish`, {})
  if (!result.success) {
    console.error('Publishing failed:', result.post.error_message)
  }
} catch (error) {
  console.error('API error:', error.message)
}
```

---

## 🧪 Testing Migration

### Test Checklist

- [ ] Update all API calls to use new endpoint
- [ ] Test Facebook publishing
- [ ] Test Instagram publishing
- [ ] Test FBINSTA (both platforms)
- [ ] Test error handling
- [ ] Test with overrides
- [ ] Verify response handling
- [ ] Check for deprecation warnings in logs

### Test Script

```bash
# Test old endpoint (should show deprecation warning)
curl -X POST http://localhost:9000/admin/socials/publish-both \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"post_id": "post_123"}'

# Test new endpoint
curl -X POST http://localhost:9000/admin/social-posts/post_123/publish \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## 📅 Timeline

| Date | Action |
|------|--------|
| **Today** | Deprecation notice added |
| **Week 1** | Update client code |
| **Week 2-4** | Test in staging |
| **Week 4-8** | Monitor production usage |
| **Week 8-12** | Final migration push |
| **Day 90** | Old endpoint removed |

---

## 🆘 Support

### Common Issues

**Q: Can I still use the old endpoint?**  
A: Yes, but it's deprecated and will be removed in 90 days. Please migrate as soon as possible.

**Q: Will the old endpoint break immediately?**  
A: No, it will continue to work for 90 days with deprecation warnings.

**Q: What if I can't migrate in time?**  
A: Contact the development team for an extension or migration assistance.

**Q: Are there any breaking changes?**  
A: The response structure is mostly the same, with an additional `retry_info` field. This is backward compatible.

**Q: Do I need to change my database?**  
A: No, the database schema remains the same.

---

## ✅ Migration Checklist

### For Developers

- [ ] Identify all usages of `/admin/socials/publish-both`
- [ ] Update API calls to use `/admin/social-posts/:id/publish`
- [ ] Update response handling (add `retry_info` if needed)
- [ ] Test all publishing scenarios
- [ ] Deploy to staging
- [ ] Test in staging environment
- [ ] Deploy to production
- [ ] Monitor for errors
- [ ] Remove old code after sunset date

### For DevOps

- [ ] Monitor deprecation warnings in logs
- [ ] Track usage of old endpoint
- [ ] Set up alerts for continued usage after week 8
- [ ] Plan removal of old endpoint on sunset date
- [ ] Update API documentation
- [ ] Notify stakeholders of deprecation

---

## 📚 Additional Resources

- [Unified Workflow Documentation](./UNIFIED_WORKFLOW_DOCUMENTATION.md)
- [API Documentation](./API_DOCUMENTATION.md)
- [Deployment Checklist](./DEPLOYMENT_CHECKLIST.md)
- [Troubleshooting Guide](./UNIFIED_WORKFLOW_DOCUMENTATION.md#troubleshooting)

---

**Questions?** Contact the development team or check the documentation.

**Last Updated**: November 19, 2025  
**Deprecation Date**: November 19, 2025  
**Sunset Date**: February 17, 2026 (90 days)
