# Analytics Script Auto-Deployment Setup

This document explains how to set up automatic deployment of the analytics script to Cloudflare R2 CDN.

## 🎯 What This Does

When you push changes to `assets/analytics.js`, GitHub Actions will automatically:
1. ✅ Build the minified `analytics.min.js`
2. ✅ Upload to Cloudflare R2 bucket
3. ✅ Purge Cloudflare CDN cache
4. ✅ Make the new version available immediately

**No manual CDN uploads or cache purging needed!** 🚀

---

## 🔐 Required GitHub Secrets

You need to add these secrets to your GitHub repository:

### 1. Cloudflare Account Credentials

**CLOUDFLARE_ACCOUNT_ID**
- Go to Cloudflare Dashboard → R2 (or any page)
- Find your Account ID on the right sidebar
- Example: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

**CLOUDFLARE_API_TOKEN**
- Go to Cloudflare Dashboard → My Profile → API Tokens
- Click "Create Token"
- Use "Edit Cloudflare Workers" template OR create custom token with:
  - **Account.Cloudflare R2 Storage** - Edit permission
  - **Zone.Cache Purge** - Purge permission
- Scope to your specific account and zone
- Copy the token (shown only once!)

### 2. R2 Bucket Configuration

**R2_BUCKET_NAME**
- Your R2 bucket name (e.g., `automatic`)
- This is just the bucket name, not a full path

### 3. Cloudflare Zone ID

**CLOUDFLARE_ZONE_ID**
- Go to Cloudflare Dashboard → Select your domain (automatic.jaalyantra.com)
- Find Zone ID on the right sidebar (Overview page)
- Example: `z1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

---

## 📝 Adding Secrets to GitHub

### Via GitHub Web Interface:

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret:

```
Name: CLOUDFLARE_ACCOUNT_ID
Value: [your-account-id]

Name: CLOUDFLARE_API_TOKEN
Value: [your-api-token]

Name: R2_BUCKET_NAME
Value: automatic

Name: CLOUDFLARE_ZONE_ID
Value: [your-zone-id]
```

### Via GitHub CLI:

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set CLOUDFLARE_API_TOKEN
gh secret set R2_BUCKET_NAME
gh secret set CLOUDFLARE_ZONE_ID
```

---

## 🚀 How to Use

### Automatic Deployment (Recommended)

Just push changes to the analytics script:

```bash
# Edit the analytics script
vim assets/analytics.js

# Commit and push
git add assets/analytics.js
git commit -m "feat: add new analytics feature"
git push origin main
```

GitHub Actions will automatically:
- Build the script
- Upload to CDN
- Purge cache
- Deploy in ~2 minutes

### Manual Deployment

You can also trigger the workflow manually:

1. Go to **Actions** tab in GitHub
2. Select **Deploy Analytics Script to CDN**
3. Click **Run workflow**
4. Select branch and click **Run workflow**

---

## 🔍 Monitoring Deployments

### Check Deployment Status:

1. Go to **Actions** tab in GitHub
2. Click on the latest workflow run
3. View the deployment summary

### Verify Deployment:

```bash
# Check if new version is live
curl -I "https://automatic.jaalyantra.com/analytics.min.js"

# Download and verify content
curl "https://automatic.jaalyantra.com/analytics.min.js" | head -c 500
```

---

## 🎨 Frontend Integration

### No Version Parameter Needed!

Since the workflow purges the cache automatically, you can use the CDN URL without version parameters:

```html
<!-- Simple, clean URL -->
<script 
  src="https://automatic.jaalyantra.com/analytics.min.js" 
  data-website-id="YOUR_WEBSITE_ID"
  defer
></script>
```

### With Version Parameter (Optional):

If you still want version control:

```html
<!-- With version from package.json -->
<script 
  src="https://automatic.jaalyantra.com/analytics.min.js?v=1.0.3" 
  data-website-id="YOUR_WEBSITE_ID"
  defer
></script>
```

---

## 🐛 Troubleshooting

### Deployment Failed?

**Check the logs:**
1. Go to Actions tab
2. Click on failed workflow
3. Expand the failed step

**Common issues:**

1. **Invalid R2 credentials**
   - Verify R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY
   - Check endpoint URL format

2. **Cache purge failed**
   - Verify CLOUDFLARE_API_TOKEN has "Cache Purge" permission
   - Check CLOUDFLARE_ZONE_ID is correct

3. **Build failed**
   - Check if `yarn build:analytics` works locally
   - Verify terser is in devDependencies

### Cache Not Purging?

**Manual cache purge:**

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/YOUR_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"files":["https://automatic.jaalyantra.com/analytics.min.js"]}'
```

### Old Version Still Showing?

**Force refresh in browser:**
- Chrome/Firefox: Ctrl+Shift+R (Cmd+Shift+R on Mac)
- Or open in incognito/private mode

---

## 📊 Workflow Triggers

The workflow runs when:

1. **Push to main/master** with changes to:
   - `assets/analytics.js`
   - `src/scripts/build-analytics.js`
   - `.github/workflows/deploy-analytics.yml`

2. **Manual trigger** via GitHub Actions UI

---

## 🔒 Security Best Practices

1. **Never commit secrets** to the repository
2. **Use least-privilege tokens** (only required permissions)
3. **Rotate tokens regularly** (every 90 days)
4. **Monitor workflow runs** for unauthorized changes
5. **Use branch protection** to prevent direct pushes to main

---

## 📈 Benefits

✅ **Automated deployment** - No manual CDN uploads
✅ **Cache management** - Automatic cache purging
✅ **Version tracking** - Uses package.json version
✅ **Fast rollout** - Changes live in ~2 minutes
✅ **Audit trail** - All deployments logged in GitHub
✅ **Rollback support** - Revert commits to rollback
✅ **No downtime** - Seamless updates

---

## 🎯 Next Steps

1. Add the required secrets to GitHub
2. Test the workflow with a small change
3. Monitor the first deployment
4. Remove manual deployment steps from your process
5. Enjoy automated deployments! 🎉

---

## 📞 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review workflow logs in GitHub Actions
3. Verify all secrets are correctly set
4. Test R2 credentials manually with AWS CLI

**Happy deploying!** 🚀
