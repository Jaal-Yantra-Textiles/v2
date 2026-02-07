---
title: "Analytics Script - Deployment Guide"
sidebar_label: "Script Deployment"
sidebar_position: 10
---

# Analytics Script - Deployment Guide

How the client-side tracking script is built and served.

## 📁 File Structure

```
jyt/
├── assets/
│   ├── analytics.js          Source file (development)
│   ├── analytics.min.js      Built file (production)
│   └── README.md             Build documentation
├── src/
│   ├── scripts/
│   │   └── build-analytics.js    Build script (Terser)
│   └── api/web/analytics.js/
│       └── route.ts          Serves the script via API
└── package.json              Contains build:analytics script
```

---

## 🔨 Building

### Command

```bash
yarn build:analytics
```

### What It Does

1. Reads `assets/analytics.js` (source)
2. Minifies with Terser
3. Writes `assets/analytics.min.js` (output)
4. Shows compression stats

### Output

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

## 🌐 Serving

### API Route

**Endpoint:** `GET /web/analytics.js`

**File:** `src/api/web/analytics.js/route.ts`

```typescript
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const scriptPath = path.join(process.cwd(), "assets", "analytics.min.js");
  const script = fs.readFileSync(scriptPath, "utf8");
  
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "public, max-age=86400"); // 24 hours
  res.setHeader("Access-Control-Allow-Origin", "*"); // All domains
  
  res.send(script);
};
```

### Features

✅ **No authentication** - Public endpoint
✅ **CORS enabled** - Works from any domain
✅ **Cached** - 24-hour browser cache
✅ **Gated-friendly** - Bypasses middleware

---

## 🎯 Client Usage

### Production URL

```
https://api.jaalyantra.in/web/analytics.js
```

### HTML Integration

```html
<!DOCTYPE html>
<html>
  <head>
    <script 
      src="https://api.jaalyantra.in/web/analytics.js" 
      data-website-id="01JM1PEW9H0ES7GGMD173GM2T9"
      data-api-url="https://api.jaalyantra.in"
      defer
    ></script>
  </head>
  <body>
    <!-- Your content -->
  </body>
</html>
```

### Next.js Integration

```tsx
// app/layout.tsx
import Script from 'next/script'

export default function RootLayout({ children }) {
  return (
    <html>
      <head>
        <Script
          src="https://api.jaalyantra.in/web/analytics.js"
          data-website-id={process.env.NEXT_PUBLIC_WEBSITE_ID}
          data-api-url="https://api.jaalyantra.in"
          strategy="afterInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

---

## 🔄 Development Workflow

### 1. Make Changes

Edit `assets/analytics.js`:

```javascript
// Add new feature
function trackCustomEvent(name, data) {
  // Your code
}
```

### 2. Test Locally

```html
<!-- Use unminified for debugging -->
<script src="http://localhost:9000/web/analytics.js"></script>
```

### 3. Build Production Version

```bash
yarn build:analytics
```

### 4. Test Minified Version

Restart server and test with production URL.

### 5. Deploy

```bash
git add assets/analytics.js assets/analytics.min.js
git commit -m "Update analytics script"
git push
```

---

## 🔒 Security

### CORS Configuration

The route allows all origins:

```typescript
res.setHeader("Access-Control-Allow-Origin", "*");
```

This is safe because:
- ✅ Script is public (no sensitive data)
- ✅ Read-only endpoint
- ✅ No authentication needed
- ✅ Designed to be embedded anywhere

### Content Security Policy

Clients should allow the script:

```
script-src 'self' https://api.jaalyantra.in;
connect-src 'self' https://api.jaalyantra.in;
```

---

## 📊 Performance

### File Sizes

| Version | Size | Gzipped | Load Time |
|---------|------|---------|-----------|
| Development | ~6 KB | ~2 KB | ~20ms |
| Production | ~2 KB | ~0.7 KB | ~10ms |

### Caching

```
Cache-Control: public, max-age=86400
```

- First load: Downloads from server
- Subsequent loads: Served from browser cache
- Cache duration: 24 hours
- Updates: Require cache bust or wait 24h

### Cache Busting

To force update:

```html
<script src="https://api.jaalyantra.in/web/analytics.js?v=2"></script>
```

---

## 🐛 Troubleshooting

### Script Not Found (404)

**Error:** `Analytics script not found`

**Cause:** `assets/analytics.min.js` doesn't exist

**Fix:**
```bash
yarn build:analytics
```

### CORS Error

**Error:** `Access to fetch at '...' has been blocked by CORS`

**Cause:** API route not setting CORS headers

**Fix:** Check `src/api/web/analytics.js/route.ts` has:
```typescript
res.setHeader("Access-Control-Allow-Origin", "*");
```

### Script Not Loading

**Check:**
1. Server is running
2. Route exists: `/web/analytics.js`
3. File exists: `assets/analytics.min.js`
4. No 404 in network tab

**Debug:**
```bash
curl http://localhost:9000/web/analytics.js
# Should return JavaScript code
```

### Old Version Loading

**Cause:** Browser cache

**Fix:**
```html
<!-- Add version query param -->
<script src="https://api.jaalyantra.in/web/analytics.js?v=2"></script>
```

Or clear browser cache.

---

## 📋 Deployment Checklist

Before deploying updates:

- [ ] Edit `assets/analytics.js`
- [ ] Test changes locally
- [ ] Run `yarn build:analytics`
- [ ] Verify `assets/analytics.min.js` created
- [ ] Test minified version locally
- [ ] Check file size (~2 KB)
- [ ] Commit both files
- [ ] Deploy to production
- [ ] Test production URL
- [ ] Verify in client websites
- [ ] Check browser console
- [ ] Verify events in admin dashboard

---

## 🎉 Summary

### How It Works

1. **Source:** `assets/analytics.js` (editable)
2. **Build:** `yarn build:analytics` (minifies)
3. **Output:** `assets/analytics.min.js` (deployed)
4. **Serve:** `GET /web/analytics.js` (API route)
5. **Use:** `<script src="https://api.jaalyantra.in/web/analytics.js">`

### Key Points

✅ Script in `assets/` folder (not `public/`)
✅ Served via API route (bypasses middleware)
✅ No authentication required
✅ CORS enabled for all domains
✅ Cached for 24 hours
✅ ~2 KB minified, ~0.7 KB gzipped

**Ready for production!** 🚀
