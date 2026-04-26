# Facebook Post Insights Strategy

## Executive Summary

Based on Facebook's API deprecations (September 2024) and current API limitations, we need to optimize our insights sync strategy to focus on **available metrics** that don't require special permissions and won't hit API quota limits.

## Current State of Facebook Insights API

### ❌ Deprecated Metrics (No Longer Available)
- `post_engaged_users` - **DEPRECATED**
- `post_clicks_unique` - **DEPRECATED**  
- `post_negative_feedback` - **DEPRECATED**
- `post_impressions_by_story_type` - **DEPRECATED**
- `post_impressions_organic` - **DEPRECATED**

### ⚠️ Permission-Required Metrics
These require `pages_read_engagement` permission (needs App Review):
- `post_impressions`
- `post_impressions_unique` (reach)
- `post_impressions_paid`
- `post_impressions_organic_v2`
- `post_clicks`

### ✅ Always Available Metrics (No Special Permission)
These work with basic `pages_manage_posts` permission:

#### 1. **Post Object Fields** (Single API Call)
```
GET /{post-id}?fields=...
```
- `message` - Post caption/text
- `created_time` - When post was created
- `permalink_url` - Link to post
- `shares.summary(true)` - Share count
- `reactions.summary(true)` - Total reactions count
- `comments.summary(true)` - Total comments count
- `attachments` - Media info

#### 2. **Detailed Reactions** (6 API Calls - One per type)
```
GET /{post-id}/reactions?type={TYPE}&summary=total_count
```
- LIKE
- LOVE
- WOW
- HAHA
- SAD
- ANGRY

#### 3. **Comments Data** (1 API Call)
```
GET /{post-id}/comments?fields=id,message,from,created_time,like_count&limit=100
```
- Full comment text
- Commenter info
- Comment timestamps
- Comment likes

## Recommended Sync Strategy

### Priority 1: Core Engagement Metrics (No Permission Required)
**API Calls: 2 total**

1. **Main Post Data** (1 call)
   - Shares count
   - Total reactions
   - Total comments
   - Permalink
   - Created time

2. **Comments with Details** (1 call)
   - Up to 100 recent comments
   - Full comment data
   - Engagement per comment

**Why**: These metrics are always available, provide real engagement data, and use minimal API quota.

### Priority 2: Reaction Breakdown (Optional)
**API Calls: 6 total (one per reaction type)**

- Individual counts for each reaction type
- Useful for sentiment analysis

**Why**: Nice to have but uses 6 API calls. Consider batching or caching.

### Priority 3: Advanced Metrics (Requires Permission)
**API Calls: 1 total**

Only if `pages_read_engagement` is granted:
- Impressions
- Reach
- Clicks

**Why**: Requires App Review. Skip for now or implement with graceful fallback.

## Optimized Implementation Plan

### Phase 1: Core Metrics (Implement Now)
```typescript
// Single efficient call
GET /{post-id}?fields=message,created_time,permalink_url,shares.summary(true),reactions.summary(true),comments.summary(true)

// Get comment details
GET /{post-id}/comments?fields=id,message,from,created_time,like_count&limit=100
```

**Total API Calls**: 2 per post
**Quota Impact**: Minimal
**Permission Required**: `pages_manage_posts` (already have)

### Phase 2: Reaction Breakdown (Optional Enhancement)
```typescript
// Only if needed for detailed sentiment
for each reaction_type in [LIKE, LOVE, WOW, HAHA, SAD, ANGRY]:
  GET /{post-id}/reactions?type={type}&summary=total_count&limit=0
```

**Total API Calls**: +6 per post
**Quota Impact**: Moderate
**Permission Required**: `pages_manage_posts`

### Phase 3: Advanced Metrics (Future - After App Review)
```typescript
// Only if pages_read_engagement granted
GET /{post-id}/insights?metric=post_impressions,post_impressions_unique,post_clicks
```

**Total API Calls**: +1 per post
**Quota Impact**: Low
**Permission Required**: `pages_read_engagement` (needs review)

## Calculated Metrics

We can calculate these from available data:

### Engagement Rate
```
engagement_rate = (reactions + comments + shares) / followers * 100
```

### Engagement Score
```
engagement_score = (reactions * 1) + (comments * 3) + (shares * 5)
```
*Weighted by value: shares > comments > reactions*

### Sentiment Score (if using reaction breakdown)
```
positive = LIKE + LOVE + WOW + HAHA
negative = SAD + ANGRY
sentiment_score = (positive - negative) / total_reactions * 100
```

## API Quota Management

### Facebook Rate Limits
- **Page-level**: 200 calls per hour per user
- **App-level**: Varies by app tier

### Optimization Strategies

1. **Batch Requests** (Recommended)
   ```typescript
   // Single batch call for multiple posts
   POST /
   {
     "batch": [
       {"method": "GET", "relative_url": "post1?fields=..."},
       {"method": "GET", "relative_url": "post2?fields=..."},
       {"method": "GET", "relative_url": "post3?fields=..."}
     ]
   }
   ```
   **Benefit**: 50 posts = 1 API call instead of 50

2. **Smart Caching**
   - Cache insights for 6-24 hours
   - Only sync recent posts (last 30 days)
   - Skip posts older than 90 days

3. **Incremental Sync**
   - Sync new posts immediately
   - Sync active posts (< 7 days) every 6 hours
   - Sync older posts daily

## Recommended Metrics to Track

### Must-Have (Always Available)
- ✅ Shares
- ✅ Total Reactions
- ✅ Total Comments
- ✅ Comment Details
- ✅ Permalink
- ✅ Created Time

### Nice-to-Have (6 extra calls)
- 🟡 Reaction Breakdown (LIKE, LOVE, WOW, HAHA, SAD, ANGRY)

### Future (Needs App Review)
- 🔒 Impressions
- 🔒 Reach
- 🔒 Clicks

## Implementation Checklist

- [ ] Update `syncFacebookInsights` to use optimized field list
- [ ] Implement batch request support for bulk sync
- [ ] Add calculated metrics (engagement rate, sentiment)
- [ ] Remove deprecated metrics from code
- [ ] Add caching layer (6-24 hour TTL)
- [ ] Implement incremental sync strategy
- [ ] Update UI to show available metrics only
- [ ] Add "Request Advanced Metrics" CTA for App Review
- [ ] Document quota usage in admin panel

## Expected Results

### Before Optimization
- API Calls per post: 8-10
- Permission required: `pages_read_engagement`
- Success rate: Low (permission errors)

### After Optimization
- API Calls per post: 2 (core) or 8 (with reactions)
- Permission required: `pages_manage_posts` (already have)
- Success rate: High (no permission issues)
- Quota usage: 75% reduction

## Next Steps

1. **Immediate**: Implement Phase 1 (core metrics, 2 API calls)
2. **Week 1**: Add batch request support
3. **Week 2**: Implement caching and incremental sync
4. **Future**: Apply for `pages_read_engagement` permission
