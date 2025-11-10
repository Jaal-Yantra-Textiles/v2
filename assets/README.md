# Analytics Tracking Script - Build & Deployment

Client-side tracking script for JYT Analytics with professional minification.

## 📦 Files

```
jyt/
├── assets/
│   ├── analytics.js          Development version (~6 KB, readable)
│   └── analytics.min.js      Production version (~2 KB, minified)
├── src/
│   ├── scripts/
│   │   └── build-analytics.js    Build script using Terser
│   └── api/web/analytics.js/
│       └── route.ts          API endpoint to serve script
```

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd /Users/saranshsharma/Documents/jyt
yarn install
```

### 2. Build Minified Version

```bash
yarn build:analytics
```

### 3. Output

```
🔨 Building analytics.min.js for production...

📖 Read assets/analytics.js
   Size: 6.12 KB

⚙️  Minifying with Terser...

✅ Wrote assets/analytics.min.js
   Size: 2.04 KB
   Compression: 66.7% smaller

📦 Estimated gzipped size: ~0.68 KB

✨ Build complete!
```

---

## 📊 What Gets Built

| Version | Size | Gzipped | Use Case |
|---------|------|---------|----------|
| `analytics.js` | ~6 KB | ~2 KB | Development, debugging |
| `analytics.min.js` | ~2 KB | ~0.7 KB | Production websites |

**Compression: 66% smaller!**

---

## 🎯 Deployment

### Serve from JYT Backend

The script is served via API route (no authentication required):

```
https://api.jaalyantra.in/web/analytics.js
```

**Route:** `src/api/web/analytics.js/route.ts`
- Serves `assets/analytics.min.js`
- No authentication required
- CORS enabled for all domains
- Cached for 24 hours

### Client Website Usage

```html
<script 
  src="https://api.jaalyantra.in/web/analytics.js" 
  data-website-id="01JM1PEW9H0ES7GGMD173GM2T9"
  data-api-url="https://api.jaalyantra.in"
  defer
></script>
```

---

## 🔧 Build Configuration

The build script uses Terser with these optimizations:

### Compression
- ✅ Dead code elimination
- ✅ Variable name mangling
- ✅ Function inlining
- ✅ Constant folding
- ✅ Multiple compression passes

### Preserved
- ✅ `window.jytAnalytics` global API
- ✅ Console logs (for debugging)
- ✅ Error handling

---

## 🔄 Development Workflow

### Making Changes

1. **Edit** `public/analytics.js`
2. **Test** locally with unminified version
3. **Build** minified version:
   ```bash
   yarn build:analytics
   ```
4. **Test** minified version
5. **Commit** both files:
   ```bash
   git add public/analytics.js public/analytics.min.js
   git commit -m "Update analytics tracking script"
   ```
6. **Deploy** to production

---

## 🧪 Testing

### Test Development Version

```html
<script 
  src="http://localhost:9000/analytics.js" 
  data-website-id="test"
  defer
></script>
```

Check console:
```
[Analytics] Initialized for website: test
[Analytics] Heartbeat enabled (30s interval)
```

### Test Production Version

```html
<script 
  src="http://localhost:9000/analytics.min.js" 
  data-website-id="test"
  defer
></script>
```

Should work identically!

### Verify Functionality

```javascript
// Check API exists
console.log(window.jytAnalytics);
// { track, trackPageview, startHeartbeat, stopHeartbeat }

// Test tracking
window.jytAnalytics.track('test_event', { test: true });

// Check network tab for POST to /web/analytics/track
```

---

## 📋 Features

### Automatic Tracking
- ✅ Pageviews on load
- ✅ SPA navigation (Next.js, React Router)
- ✅ Session management (30-min timeout)
- ✅ Visitor ID (localStorage)

### Real-time Features
- ✅ Heartbeat every 30 seconds
- ✅ Visibility-aware (pauses when hidden)
- ✅ Live visitor tracking

### Custom Events
```javascript
window.jytAnalytics.track('button_clicked', {
  button_id: 'signup',
  location: 'hero'
});
```

---

## 🌐 Serving the Script

### Option 1: Direct from Backend

Add static file serving in MedusaJS:

```typescript
// src/api/middlewares.ts
app.use('/analytics.min.js', express.static('public/analytics.min.js'));
```

### Option 2: CDN

Upload to CDN:
```
https://cdn.jaalyantra.in/analytics.min.js
```

### Option 3: Cloudflare

Upload to Cloudflare Pages/R2 for global distribution.

---

## 🔒 Security

### HTTPS Only

```html
<!-- ✅ Good -->
<script src="https://api.jaalyantra.in/analytics.min.js"></script>

<!-- ❌ Bad -->
<script src="http://api.jaalyantra.in/analytics.min.js"></script>
```

### CORS Configuration

Ensure your API allows requests from client domains:

```typescript
// In medusa-config.ts
http: {
  cors: "https://yourdomain.com,https://www.yourdomain.com"
}
```

---

## 📚 Documentation

- **Tracking Guide:** `/docs/ANALYTICS_TRACKING.md`
- **Real-time Guide:** `/docs/ANALYTICS_REALTIME.md`
- **Implementation:** `/docs/ANALYTICS_IMPLEMENTATION.md`

---

## 🐛 Troubleshooting

### Build Fails

**Error:** `Cannot find module 'terser'`

**Fix:**
```bash
yarn install
```

### Script Not Loading

**Check:**
1. File exists at `public/analytics.min.js`
2. Server is serving static files
3. CORS is configured
4. HTTPS is used

### No Events Tracked

**Check:**
1. `data-website-id` is correct
2. `data-api-url` points to your API
3. Network tab shows POST requests
4. No console errors

---

## 🎉 Summary

You now have a professional build setup for the analytics tracking script!

### Commands:
```bash
yarn build:analytics  # Build minified version
```

### Output:
- `public/analytics.min.js` (~2 KB)
- Ready for production deployment
- 66% smaller than original

### Deployment:
```html
<script 
  src="https://api.jaalyantra.in/analytics.min.js" 
  data-website-id="YOUR_ID"
  defer
></script>
```

**Ready to track!** 📊🚀
