# Analytics System - Complete Implementation Guide

## 🎉 System Status: PRODUCTION READY

Your analytics system is fully functional and ready to track website visitors!

---

## 📋 What's Implemented

### ✅ Backend (MedusaJS v2)
- **Custom Analytics Module** (`custom_analytics`)
- **3 Data Models**: AnalyticsEvent, AnalyticsSession, AnalyticsDailyStats
- **Complete CRUD Workflows**
- **Public Tracking API**: `/web/analytics/track`
- **Admin Query APIs**: Filter by website, page, visitor, session
- **Reporting APIs**: Stats & timeseries for dashboards
- **Read-only Module Link**: Website ↔ Analytics (zero overhead)
- **12 Integration Tests**: All passing ✅

### ✅ Client-Side Tracking
- **Lightweight Script**: `analytics.js` (~2KB)
- **Auto Pageview Tracking**: Including SPA navigation
- **Custom Event API**: `window.jytAnalytics.track()`
- **Session Management**: 30-minute timeout
- **Privacy-Focused**: No cookies, no PII, GDPR compliant

### ✅ Admin UI
- **Analytics Modal**: View website analytics in admin panel
- **Action Menu Integration**: Easy access from website detail page
- **Real-time Stats**: Views, visitors, sessions, custom events
- **Recent Events List**: Last 10 events with timestamps
- **Time Range Selector**: 7, 30, or 90 days

---

## 🚀 Quick Start

### 1. Add Tracking Script to Your Website

```html
<!-- Add to your website's <head> or before </body> -->
<script 
  src="/analytics.js" 
  data-website-id="01JM1PEW9H0ES7GGMD173GM2T9"
  data-api-url="http://localhost:9000"
  defer
></script>
```

**For Next.js** (already added to `/app/layout.tsx`):
```tsx
<script 
  src="/analytics.js" 
  data-website-id="01JM1PEW9H0ES7GGMD173GM2T9"
  data-api-url="http://localhost:9000"
  defer
/>
```

### 2. View Analytics in Admin

1. Navigate to **Websites** in admin panel
2. Click on your website
3. Click **Analytics** in the action menu (top right)
4. View your stats! 📊

---

## 📊 Available APIs

### 1. Track Events (Public)
```bash
POST /web/analytics/track
{
  "website_id": "01JM1PEW9H0ES7GGMD173GM2T9",
  "event_type": "pageview",
  "pathname": "/products",
  "visitor_id": "visitor_xyz",
  "session_id": "session_abc"
}
```

### 2. Query Events (Admin)
```bash
# All events for website
GET /admin/analytics-events?website_id=01JM1PEW9H0ES7GGMD173GM2T9

# Filter by page
GET /admin/analytics-events?website_id=01JM1PEW9H0ES7GGMD173GM2T9&pathname=/products

# Filter by visitor
GET /admin/analytics-events?website_id=01JM1PEW9H0ES7GGMD173GM2T9&visitor_id=visitor_xyz
```

### 3. Get Stats (Admin)
```bash
# Last 30 days
GET /admin/analytics-events/stats?website_id=01JM1PEW9H0ES7GGMD173GM2T9&days=30

# Custom date range
GET /admin/analytics-events/stats?website_id=01JM1PEW9H0ES7GGMD173GM2T9&start_date=2024-01-01&end_date=2024-01-31
```

### 4. Get Timeseries (Admin)
```bash
# Daily data for charts
GET /admin/analytics-events/timeseries?website_id=01JM1PEW9H0ES7GGMD173GM2T9&days=30&interval=day

# Hourly data
GET /admin/analytics-events/timeseries?website_id=01JM1PEW9H0ES7GGMD173GM2T9&days=1&interval=hour
```

### 5. Website Analytics Overview (Admin)
```bash
# Get website with analytics
GET /admin/websites/01JM1PEW9H0ES7GGMD173GM2T9/analytics?days=30
```

---

## 🎯 What's Tracked

### Automatically:
- ✅ **Page Views**: Every page visit
- ✅ **Referrer Sources**: Google, Facebook, Direct, etc.
- ✅ **Browser & OS**: Parsed from user agent
- ✅ **Device Type**: Desktop, mobile, tablet
- ✅ **Country**: From IP (not stored)
- ✅ **Sessions**: 30-minute timeout
- ✅ **Unique Visitors**: Anonymous IDs

### Manually (Custom Events):
```javascript
// Track button click
window.jytAnalytics.track('button_click', {
  button_id: 'signup',
  location: 'hero'
});

// Track form submission
window.jytAnalytics.track('form_submit', {
  form_id: 'contact',
  success: true
});
```

---

## 🔒 Privacy Features

- ❌ **No Cookies**: Uses localStorage/sessionStorage
- ❌ **No PII**: No names, emails, or personal data
- ❌ **No IP Storage**: Used only for geo-location, then discarded
- ❌ **No Cross-Site Tracking**
- ❌ **No Query Parameters**: Only pathname tracked
- ✅ **Anonymous IDs**: Random, not linked to users
- ✅ **GDPR Compliant**: No consent required

---

## 📁 File Structure

```
jyt/
├── src/
│   ├── modules/analytics/
│   │   ├── models/
│   │   │   ├── analytics-event.ts
│   │   │   ├── analytics-session.ts
│   │   │   └── analytics-daily-stats.ts
│   │   ├── service.ts
│   │   └── index.ts
│   ├── workflows/analytics/
│   │   ├── track-analytics-event.ts
│   │   ├── create-analytics-event.ts
│   │   ├── list-analytics-event.ts
│   │   └── reports/
│   │       ├── get-analytics-stats.ts
│   │       └── get-analytics-timeseries.ts
│   ├── api/
│   │   ├── web/analytics/track/route.ts
│   │   └── admin/
│   │       ├── analytics-events/
│   │       │   ├── route.ts
│   │       │   ├── stats/route.ts
│   │       │   └── timeseries/route.ts
│   │       └── websites/[id]/
│   │           ├── analytics/route.ts
│   │           └── tracking-code/route.ts
│   ├── links/
│   │   └── website-analytics-link.ts (read-only)
│   └── admin/
│       ├── routes/websites/[id]/analytics/page.tsx
│       ├── components/websites/
│       │   ├── website-analytics-modal.tsx
│       │   └── website-general-section.tsx (+ Analytics button)
│       └── hooks/api/analytics.ts
├── integration-tests/
│   └── http/analytics/
│       └── track-analytics-event.spec.ts (12 tests ✅)
└── docs/
    ├── ANALYTICS_IMPLEMENTATION.md
    ├── ANALYTICS_ARCHITECTURE_DECISION.md
    ├── ANALYTICS_WEBSITE_SETUP.md
    ├── ANALYTICS_REPORTING_APIS.md
    ├── ANALYTICS_MODULE_LINKING_READONLY.md
    └── ANALYTICS_COMPLETE_GUIDE.md (this file)

jyt-web/jyt-web/
├── public/
│   └── analytics.js (tracking script)
├── app/
│   └── layout.tsx (tracking script added)
└── docs/
    └── ANALYTICS_TRACKING.md
```

---

## 🧪 Testing

### Run Integration Tests
```bash
cd /Users/saranshsharma/Documents/jyt
npm run test:integration -- analytics
```

**Expected Result**: All 12 tests passing ✅

### Manual Testing

1. **Start Backend**:
   ```bash
   cd /Users/saranshsharma/Documents/jyt
   npm run dev  # Port 9000
   ```

2. **Start Frontend**:
   ```bash
   cd /Users/saranshsharma/Documents/jyt-web/jyt-web
   npm run dev  # Port 3000
   ```

3. **Open Browser**:
   - Visit: `http://localhost:3000`
   - Open DevTools → Console
   - Look for: `[Analytics] Initialized for website: 01JM1PEW9H0ES7GGMD173GM2T9`
   - Navigate between pages
   - Check Network tab for POST to `/web/analytics/track`

4. **View Analytics**:
   - Go to: `http://localhost:9000/app/websites/01JM1PEW9H0ES7GGMD173GM2T9`
   - Click **Analytics** button
   - See your tracking data! 📊

---

## 🎨 Admin UI Features

### Analytics Modal Shows:

1. **Time Range Selector**
   - Last 7 days
   - Last 30 days
   - Last 90 days

2. **Website Info**
   - Name
   - Domain
   - Status badge

3. **Overview Stats** (4 cards)
   - 👁️ Total Views
   - 👥 Unique Visitors
   - 🔄 Sessions
   - ⚡ Custom Events

4. **Recent Events** (last 10)
   - Event type badge
   - Event name (if custom)
   - Pathname
   - Timestamp

5. **Quick Stats**
   - Total events count
   - Pages per visitor

---

## 🔧 Configuration

### Environment Variables

```env
# Backend (.env)
WEB_CORS=http://localhost:3000,https://your-domain.com
MEDUSA_BACKEND_URL=http://localhost:9000
```

### Website ID

Your website ID: `01JM1PEW9H0ES7GGMD173GM2T9`

This is used in:
- Tracking script: `data-website-id="01JM1PEW9H0ES7GGMD173GM2T9"`
- API queries: `?website_id=01JM1PEW9H0ES7GGMD173GM2T9`

---

## 📚 Documentation

1. **[ANALYTICS_IMPLEMENTATION.md](./ANALYTICS_IMPLEMENTATION.md)**
   - Technical implementation details
   - Data models and workflows
   - Privacy features

2. **[ANALYTICS_ARCHITECTURE_DECISION.md](./ANALYTICS_ARCHITECTURE_DECISION.md)**
   - Why custom analytics
   - Architecture decisions
   - Module structure

3. **[ANALYTICS_WEBSITE_SETUP.md](./ANALYTICS_WEBSITE_SETUP.md)**
   - Step-by-step setup guide
   - Website linking explained
   - Troubleshooting

4. **[ANALYTICS_REPORTING_APIS.md](./ANALYTICS_REPORTING_APIS.md)**
   - Complete API reference
   - Query examples
   - React hook examples

5. **[ANALYTICS_MODULE_LINKING_READONLY.md](./ANALYTICS_MODULE_LINKING_READONLY.md)**
   - Read-only module link explained
   - Graph query examples
   - Performance benefits

6. **[ANALYTICS_TRACKING.md](../../jyt-web/jyt-web/docs/ANALYTICS_TRACKING.md)**
   - Client-side tracking guide
   - Usage examples (HTML, React, Vue, Next.js)
   - Custom event tracking

---

## ✨ Next Steps (Optional)

### Phase 4: Background Jobs
- Daily aggregation (populate `AnalyticsDailyStats`)
- Session cleanup (close inactive sessions)
- Data retention (archive old events)

### Phase 5: Advanced Features
- Real-time analytics with WebSockets
- Funnel analysis
- A/B testing support
- Heatmaps
- Export to CSV/PDF

---

## 🎉 Summary

You now have a **fully functional, production-ready analytics system**!

### What Works:
✅ Tracking pageviews and custom events
✅ Privacy-focused (no cookies, no PII)
✅ Admin UI to view analytics
✅ Powerful reporting APIs
✅ Read-only module linking (zero overhead)
✅ All tests passing
✅ Complete documentation

### How to Use:
1. ✅ Tracking script is already added to your Next.js app
2. ✅ Analytics button is in the website action menu
3. ✅ Data is being tracked (you saw it in the logs!)
4. ✅ View analytics in admin panel

**The system is live and collecting data right now!** 🚀

Visit your website, navigate around, then check the analytics modal to see your data!

---

## 🆘 Support

If you encounter any issues:

1. Check browser console for errors
2. Check Network tab for failed requests
3. Verify CORS settings in `.env`
4. Check backend logs for errors
5. Review the troubleshooting guides in the docs

---

**Built with ❤️ using MedusaJS v2**
