# Analytics Script - CDN Deployment

## 🌐 URLs

### CDN (Recommended)
```
https://automatic.jaalyantra.com/analytics.min.js
```

### API Endpoint
```
https://v3.jaalyantra.com/web/analytics/track
```

---

## 🚀 Client Usage

### Simple Setup (Just Website ID)

```html
<script 
  src="https://automatic.jaalyantra.com/analytics.min.js" 
  data-website-id="01JM1PEW9H0ES7GGMD173GM2T9"
  defer
></script>
```

**That's it!** The script automatically uses `https://v3.jaalyantra.com` as the API.

### Custom API (Optional)

```html
<script 
  src="https://automatic.jaalyantra.com/analytics.min.js" 
  data-website-id="01JM1PEW9H0ES7GGMD173GM2T9"
  data-api-url="https://custom.example.com"
  defer
></script>
```

---

## 📦 Upload to CDN

### 1. Build Latest Version

```bash
cd /Users/saranshsharma/Documents/jyt
yarn build:analytics
```

Output: `assets/analytics.min.js` (2.33 KB)

### 2. Upload File

Upload `assets/analytics.min.js` to:
```
https://automatic.jaalyantra.com/analytics.min.js
```

### 3. Verify

```bash
curl -I https://automatic.jaalyantra.com/analytics.min.js
# Should return 200 OK
```

---

## ✨ What Clients Get

### Automatic Tracking
- ✅ Pageviews
- ✅ SPA navigation
- ✅ Sessions (30-min timeout)
- ✅ Visitor IDs

### Real-time
- ✅ Heartbeat every 30s
- ✅ Live visitor tracking
- ✅ Visibility-aware

### Custom Events
```javascript
window.jytAnalytics.track('button_clicked', {
  button_id: 'signup'
});
```

---

## 🔄 Update Workflow

```bash
# 1. Edit source
vim assets/analytics.js

# 2. Build
yarn build:analytics

# 3. Upload to CDN
# Upload assets/analytics.min.js to automatic.jaalyantra.com

# 4. Done!
```

---

## 📊 Configuration

### Default API URL

```javascript
const apiUrl = script.getAttribute('data-api-url') || 'https://v3.jaalyantra.com';
```

Clients don't need to specify `data-api-url` anymore!

---

## 🎯 Examples

### Next.js

```tsx
// app/layout.tsx
import Script from 'next/script'

export default function RootLayout({ children }) {
  return (
    <html>
      <head>
        <Script
          src="https://automatic.jaalyantra.com/analytics.min.js"
          data-website-id={process.env.NEXT_PUBLIC_WEBSITE_ID}
          strategy="afterInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

### React

```html
<!-- public/index.html -->
<script 
  src="https://automatic.jaalyantra.com/analytics.min.js" 
  data-website-id="%REACT_APP_WEBSITE_ID%"
  defer
></script>
```

### WordPress

```php
<!-- header.php -->
<script 
  src="https://automatic.jaalyantra.com/analytics.min.js" 
  data-website-id="<?php echo get_option('jyt_website_id'); ?>"
  defer
></script>
```

### Static HTML

```html
<!DOCTYPE html>
<html>
<head>
  <script 
    src="https://automatic.jaalyantra.com/analytics.min.js" 
    data-website-id="01JM1PEW9H0ES7GGMD173GM2T9"
    defer
  ></script>
</head>
<body>
  <!-- Your content -->
</body>
</html>
```

---

## ✅ Summary

### URLs
- **CDN:** `https://automatic.jaalyantra.com/analytics.min.js`
- **API:** `https://v3.jaalyantra.com/web/analytics/track`

### Client Setup
```html
<script 
  src="https://automatic.jaalyantra.com/analytics.min.js" 
  data-website-id="YOUR_ID"
  defer
></script>
```

### File Size
- **Minified:** 2.33 KB
- **Gzipped:** ~0.78 KB

**Ready to deploy!** 🚀
