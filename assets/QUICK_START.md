# Analytics Script - Quick Start

## ✅ Setup Complete!

Your analytics tracking script is ready to use.

---

## 🚀 Usage

### Production URL

```
https://api.jaalyantra.in/web/analytics.js
```

### Add to Any Website

```html
<script 
  src="https://api.jaalyantra.in/web/analytics.js" 
  data-website-id="YOUR_WEBSITE_ID"
  data-api-url="https://api.jaalyantra.in"
  defer
></script>
```

Replace `YOUR_WEBSITE_ID` with the actual ID from JYT admin.

---

## 🔨 Building

### When to Build

Run this whenever you update `assets/analytics.js`:

```bash
yarn build:analytics
```

### Output

```
✅ Wrote assets/analytics.min.js
   Size: 2.32 KB
   Compression: 59.1% smaller
```

---

## 📊 How It Works

```
1. Source Code
   └─ assets/analytics.js (editable)

2. Build Process
   └─ yarn build:analytics
      └─ Minifies with Terser

3. Output
   └─ assets/analytics.min.js (deployed)

4. API Endpoint
   └─ GET /web/analytics.js
      └─ Serves analytics.min.js
         └─ No auth required
         └─ CORS enabled

5. Client Websites
   └─ <script src="https://api.jaalyantra.in/web/analytics.js">
      └─ Tracks pageviews
      └─ Tracks custom events
      └─ Sends heartbeat
```

---

## ✨ Features

### Automatic Tracking
- ✅ Pageviews on load
- ✅ SPA navigation (Next.js, React Router)
- ✅ Session management (30-min timeout)
- ✅ Visitor ID (localStorage)

### Real-time
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

## 🧪 Testing

### Local Development

```html
<script 
  src="http://localhost:9000/web/analytics.js" 
  data-website-id="test"
  defer
></script>
```

### Check Console

```
[Analytics] Initialized for website: test
[Analytics] Heartbeat enabled (30s interval)
```

### Verify API

```bash
curl http://localhost:9000/web/analytics.js
# Should return JavaScript code
```

---

## 📁 Files

```
jyt/
├── assets/
│   ├── analytics.js          Source (edit this)
│   ├── analytics.min.js      Built (auto-generated)
│   ├── README.md             Full documentation
│   └── QUICK_START.md        This file
├── src/
│   ├── scripts/
│   │   └── build-analytics.js
│   └── api/web/analytics.js/
│       └── route.ts          Serves the script
└── docs/
    └── ANALYTICS_SCRIPT_DEPLOYMENT.md
```

---

## 🎯 Common Tasks

### Update Script

```bash
# 1. Edit source
vim assets/analytics.js

# 2. Build
yarn build:analytics

# 3. Test
curl http://localhost:9000/web/analytics.js

# 4. Deploy
git add assets/
git commit -m "Update analytics script"
git push
```

### Force Cache Refresh

```html
<!-- Add version parameter -->
<script src="https://api.jaalyantra.in/web/analytics.js?v=2"></script>
```

---

## 📚 Documentation

- **Full Guide:** `assets/README.md`
- **Deployment:** `docs/ANALYTICS_SCRIPT_DEPLOYMENT.md`
- **Real-time:** `docs/ANALYTICS_REALTIME.md`
- **Implementation:** `docs/ANALYTICS_IMPLEMENTATION.md`

---

## 🎉 You're Ready!

Your analytics script is:
- ✅ Built and minified (2.32 KB)
- ✅ Served via API route
- ✅ No authentication required
- ✅ CORS enabled
- ✅ Cached for performance
- ✅ Ready for production

**Start tracking now!** 📊🚀
