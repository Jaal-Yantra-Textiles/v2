# FBINSTA Platform Support Fix for publish-post Workflow

## Problem

The `publish-social-post-workflow` was throwing an error when trying to publish posts for the FBINSTA (Facebook & Instagram combined) platform:

```
Error: Unsupported provider for this workflow: fbinsta
```

This occurred at line 168-171 in `/src/workflows/socials/publish-post.ts` in the `resolveTokensStep`.

## Root Cause

The workflow only had handlers for individual platforms:
- `"facebook"`
- `"instagram"`
- `"twitter"` / `"x"`

But not for the combined `"fbinsta"` or `"facebook & instagram"` platform.

## Solution

Added comprehensive FBINSTA support across three key areas:

### 1. Token Resolution (`resolveTokensStep`)

**Location:** Lines 136-149

Added a new case to handle FBINSTA platform that:
- Validates `pageId` is provided
- Retrieves Facebook page access token
- Returns both `fbAccessToken` and `igAccessToken` for dual publishing

```typescript
if (providerName === "fbinsta" || providerName === "facebook & instagram") {
  // For FBINSTA, we need both Facebook page token and Instagram user token
  if (!input.pageId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing pageId for FBINSTA publish")
  }
  const fb = new FacebookService()
  const pageAccessToken = await fb.getPageAccessToken(input.pageId, userAccessToken)
  return new StepResponse({ 
    providerName, 
    accessToken: pageAccessToken,
    fbAccessToken: pageAccessToken,
    igAccessToken: userAccessToken
  })
}
```

### 2. Publishing Logic (`publishStep`)

**Location:** Lines 252-278

Added FBINSTA publishing logic that:
- Publishes images to both Facebook and Instagram
- Publishes videos to Instagram as reels
- Tags results with platform identifier for proper tracking

```typescript
if (input.providerName === "fbinsta" || input.providerName === "facebook & instagram") {
  // Publish to both Facebook and Instagram
  const fb = new FacebookService()
  const ig = new InstagramService()
  const results: any[] = []
  
  const imageAttachments = attachments.filter((a) => a && a.type === "image" && a.url)
  const videoAttachments = attachments.filter((a) => a && a.type === "video" && a.url)

  // Publish to Facebook
  for (const att of imageAttachments) {
    const r = await fb.createPagePhotoPost(input.pageId!, { message, image_url: att.url }, input.fbAccessToken!)
    results.push({ kind: "fb_photo", url: att.url, response: r, platform: "facebook" })
  }

  // Publish to Instagram
  for (const att of imageAttachments) {
    const r = await ig.publishImage(input.igUserId!, { image_url: att.url, caption: message }, input.igAccessToken!)
    results.push({ kind: "ig_image", url: att.url, response: r, platform: "instagram" })
  }
  for (const att of videoAttachments) {
    const r = await ig.publishVideoAsReel(input.igUserId!, { video_url: att.url, caption: message }, input.igAccessToken!)
    results.push({ kind: "ig_reel", url: att.url, response: r, platform: "instagram" })
  }

  return new StepResponse(results)
}
```

### 3. Workflow Composition

**Location:** Lines 399-410

Updated token passing logic to properly route tokens for FBINSTA:

```typescript
fbAccessToken: transform(tokens, (t) => {
  const pName = (t as any).providerName
  return (pName === "facebook" || pName === "fbinsta" || pName === "facebook & instagram") 
    ? ((t as any).fbAccessToken || (t as any).accessToken) 
    : undefined
}),
igAccessToken: transform(tokens, (t) => {
  const pName = (t as any).providerName
  return (pName === "instagram" || pName === "fbinsta" || pName === "facebook & instagram")
    ? ((t as any).igAccessToken || (t as any).accessToken)
    : undefined
}),
```

### 4. Post Update Logic (`updatePostStep`)

**Location:** Lines 345-380

Enhanced to handle FBINSTA results with both platform IDs:

```typescript
// Check if this is FBINSTA (multiple results)
const fbResult = input.results?.find((r: any) => r.platform === "facebook" || r.kind === "fb_photo")
const igResult = input.results?.find((r: any) => r.platform === "instagram" || r.kind === "ig_image" || r.kind === "ig_reel")

if (fbResult && igResult) {
  // FBINSTA result - prefer Facebook URL
  const fbPostId = fbResult.response?.id
  postUrl = fbPostId ? `https://www.facebook.com/${fbPostId}` : postUrl
  
  // Store both IDs in insights
  insights.facebook_post_id = fbResult.response?.id
  insights.instagram_media_id = igResult.response?.id
  insights.instagram_permalink = igResult.response?.permalink
}
```

## Testing

To test the fix:

1. Create a social post with platform `FBINSTA`
2. Ensure metadata includes:
   - `page_id`: Facebook page ID
   - `ig_user_id`: Instagram business account ID
3. Add image attachments
4. Publish the post

Expected result:
- Post publishes to both Facebook and Instagram
- `insights` contains both `facebook_post_id` and `instagram_media_id`
- `post_url` points to the Facebook post
- No "Unsupported provider" error

## Files Modified

- `/src/workflows/socials/publish-post.ts`

## Related Files

- `/src/workflows/socials/publish-to-both-platforms.ts` - Alternative unified workflow
- `/src/modules/social-provider/facebook-service.ts` - Facebook API service
- `/src/modules/social-provider/instagram-service.ts` - Instagram API service
