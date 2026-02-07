---
title: "Analytics Reporting APIs"
sidebar_label: "Reporting APIs"
sidebar_position: 9
---

# Analytics Reporting APIs

Complete guide to the analytics reporting endpoints for building dashboards and reports.

---

## Overview

The analytics system provides several reporting endpoints:

1. **Stats API** - Aggregated statistics (overview, top pages, referrers, devices)
2. **Timeseries API** - Time-series data for charts
3. **Events API** - Raw event data with filtering
4. **Website Analytics API** - Website-specific overview

---

## 1. Stats API

### Endpoint
```
GET /admin/analytics-events/stats
```

### Description
Get aggregated statistics for a website. Perfect for dashboard overview pages.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `website_id` | string | ✅ Yes | Website ID |
| `days` | number | No | Number of days to include (e.g., 30) |
| `start_date` | ISO string | No | Start date (alternative to days) |
| `end_date` | ISO string | No | End date (alternative to days) |

### Examples

```bash
# Last 30 days
GET /admin/analytics-events/stats?website_id=website_abc123&days=30

# Custom date range
GET /admin/analytics-events/stats?website_id=website_abc123&start_date=2024-01-01&end_date=2024-01-31

# All time
GET /admin/analytics-events/stats?website_id=website_abc123
```

### Response

```json
{
  "website_id": "website_abc123",
  "period": {
    "start_date": "2024-01-01T00:00:00.000Z",
    "end_date": "2024-01-31T23:59:59.999Z",
    "days": 30
  },
  "stats": {
    "overview": {
      "total_events": 12345,
      "total_pageviews": 10000,
      "total_custom_events": 2345,
      "unique_visitors": 3456,
      "unique_sessions": 5678
    },
    "top_pages": [
      {
        "pathname": "/",
        "views": 5000,
        "unique_visitors": 2000
      },
      {
        "pathname": "/products",
        "views": 3000,
        "unique_visitors": 1500
      }
    ],
    "referrer_sources": [
      {
        "source": "google",
        "count": 5000,
        "percentage": 40
      },
      {
        "source": "direct",
        "count": 4000,
        "percentage": 32
      },
      {
        "source": "facebook",
        "count": 2000,
        "percentage": 16
      }
    ],
    "devices": {
      "desktop": 7000,
      "mobile": 4500,
      "tablet": 800,
      "unknown": 45
    },
    "browsers": [
      {
        "browser": "Chrome",
        "count": 8000
      },
      {
        "browser": "Safari",
        "count": 3000
      },
      {
        "browser": "Firefox",
        "count": 1000
      }
    ],
    "operating_systems": [
      {
        "os": "Windows",
        "count": 5000
      },
      {
        "os": "macOS",
        "count": 4000
      },
      {
        "os": "iOS",
        "count": 2000
      },
      {
        "os": "Android",
        "count": 1000
      }
    ]
  }
}
```

---

## 2. Timeseries API

### Endpoint
```
GET /admin/analytics-events/timeseries
```

### Description
Get time-series data for charts and graphs. Returns event counts grouped by time intervals.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `website_id` | string | ✅ Yes | Website ID |
| `days` | number | Conditional | Number of days (if not using start/end dates) |
| `start_date` | ISO string | Conditional | Start date (if not using days) |
| `end_date` | ISO string | Conditional | End date (if not using days) |
| `interval` | string | No | "hour" or "day" (default: "day") |

### Examples

```bash
# Daily data for last 30 days
GET /admin/analytics-events/timeseries?website_id=website_abc123&days=30&interval=day

# Hourly data for last 24 hours
GET /admin/analytics-events/timeseries?website_id=website_abc123&days=1&interval=hour

# Custom date range
GET /admin/analytics-events/timeseries?website_id=website_abc123&start_date=2024-01-01&end_date=2024-01-31&interval=day
```

### Response

```json
{
  "website_id": "website_abc123",
  "period": {
    "start_date": "2024-01-01T00:00:00.000Z",
    "end_date": "2024-01-31T23:59:59.999Z",
    "interval": "day"
  },
  "data": [
    {
      "timestamp": "2024-01-01",
      "pageviews": 350,
      "custom_events": 45,
      "total_events": 395,
      "unique_visitors": 120,
      "unique_sessions": 180
    },
    {
      "timestamp": "2024-01-02",
      "pageviews": 420,
      "custom_events": 52,
      "total_events": 472,
      "unique_visitors": 145,
      "unique_sessions": 210
    }
    // ... more data points
  ]
}
```

---

## 3. Events API (Existing)

### Endpoint
```
GET /admin/analytics-events
```

### Description
Get raw event data with filtering and pagination.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `website_id` | string | No | Filter by website |
| `event_type` | string | No | "pageview" or "custom_event" |
| `pathname` | string | No | Filter by page path |
| `visitor_id` | string | No | Filter by visitor |
| `session_id` | string | No | Filter by session |
| `limit` | number | No | Number of results (default: 20) |
| `offset` | number | No | Pagination offset (default: 0) |

### Examples

```bash
# All events for a website
GET /admin/analytics-events?website_id=website_abc123

# Pageviews only
GET /admin/analytics-events?website_id=website_abc123&event_type=pageview

# Specific page
GET /admin/analytics-events?website_id=website_abc123&pathname=/products

# Pagination
GET /admin/analytics-events?website_id=website_abc123&limit=50&offset=0
```

### Response

```json
{
  "analyticsEvents": [
    {
      "id": "event_123",
      "website_id": "website_abc123",
      "event_type": "pageview",
      "pathname": "/products",
      "referrer": "https://google.com",
      "referrer_source": "google",
      "visitor_id": "visitor_xyz",
      "session_id": "session_abc",
      "browser": "Chrome",
      "os": "Windows",
      "device_type": "desktop",
      "country": "US",
      "timestamp": "2024-01-15T10:30:00Z"
    }
    // ... more events
  ],
  "count": 12345
}
```

---

## 4. Website Analytics API

### Endpoint
```
GET /admin/websites/:id/analytics
```

### Description
Get analytics overview for a specific website using graph queries.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `days` | number | No | Number of days (default: 30) |

### Examples

```bash
# Last 30 days (default)
GET /admin/websites/website_abc123/analytics

# Last 7 days
GET /admin/websites/website_abc123/analytics?days=7
```

### Response

```json
{
  "website": {
    "id": "website_abc123",
    "domain": "example.com",
    "name": "My Website",
    "status": "Active"
  },
  "stats": {
    "total_events": 5000,
    "total_pageviews": 4200,
    "total_custom_events": 800,
    "unique_visitors": 1500,
    "unique_sessions": 2200
  },
  "recent_events": [
    {
      "id": "event_123",
      "event_type": "pageview",
      "pathname": "/",
      "timestamp": "2024-01-15T10:30:00Z"
    }
    // ... last 100 events
  ]
}
```

---

## Usage Examples

### Dashboard Overview Page

```typescript
// Fetch stats for last 30 days
const response = await fetch(
  `/admin/analytics-events/stats?website_id=${websiteId}&days=30`
);
const { stats } = await response.json();

// Display overview
console.log(`Total Views: ${stats.overview.total_pageviews}`);
console.log(`Unique Visitors: ${stats.overview.unique_visitors}`);
console.log(`Top Page: ${stats.top_pages[0].pathname}`);
```

### Chart Component

```typescript
// Fetch timeseries data for chart
const response = await fetch(
  `/admin/analytics-events/timeseries?website_id=${websiteId}&days=30&interval=day`
);
const { data } = await response.json();

// Use with charting library (e.g., Chart.js, Recharts)
const chartData = data.map(point => ({
  date: point.timestamp,
  views: point.pageviews,
  visitors: point.unique_visitors
}));
```

### Top Pages Table

```typescript
// Get stats
const response = await fetch(
  `/admin/analytics-events/stats?website_id=${websiteId}&days=30`
);
const { stats } = await response.json();

// Render table
stats.top_pages.forEach(page => {
  console.log(`${page.pathname}: ${page.views} views (${page.unique_visitors} visitors)`);
});
```

### Referrer Sources Pie Chart

```typescript
// Get stats
const response = await fetch(
  `/admin/analytics-events/stats?website_id=${websiteId}&days=30`
);
const { stats } = await response.json();

// Use with pie chart
const pieData = stats.referrer_sources.map(source => ({
  name: source.source,
  value: source.count,
  percentage: source.percentage
}));
```

---

## React Hook Example

```typescript
// hooks/useAnalyticsStats.ts
import { useState, useEffect } from 'react';

export function useAnalyticsStats(websiteId: string, days: number = 30) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        setLoading(true);
        const response = await fetch(
          `/admin/analytics-events/stats?website_id=${websiteId}&days=${days}`
        );
        const data = await response.json();
        setStats(data.stats);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [websiteId, days]);

  return { stats, loading, error };
}

// Usage in component
function AnalyticsDashboard({ websiteId }) {
  const { stats, loading, error } = useAnalyticsStats(websiteId, 30);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <h2>Analytics Overview</h2>
      <div>Total Views: {stats.overview.total_pageviews}</div>
      <div>Unique Visitors: {stats.overview.unique_visitors}</div>
      {/* ... more stats */}
    </div>
  );
}
```

---

## Performance Tips

### 1. Use Appropriate Date Ranges
```bash
# ✅ Good: Last 30 days
GET /admin/analytics-events/stats?website_id=abc&days=30

# ⚠️ Slower: All time (lots of data)
GET /admin/analytics-events/stats?website_id=abc
```

### 2. Use Timeseries for Charts
```bash
# ✅ Good: Timeseries endpoint for charts
GET /admin/analytics-events/timeseries?website_id=abc&days=30

# ❌ Bad: Fetching all events and grouping in frontend
GET /admin/analytics-events?website_id=abc
```

### 3. Cache Results
```typescript
// Cache stats for 5 minutes
const cacheKey = `stats_${websiteId}_${days}`;
const cached = cache.get(cacheKey);
if (cached) return cached;

const stats = await fetchStats(websiteId, days);
cache.set(cacheKey, stats, 5 * 60); // 5 minutes
return stats;
```

---

## Error Handling

### Missing website_id
```json
{
  "error": "website_id is required"
}
```

### Invalid date range
```json
{
  "error": "Either 'days' or both 'start_date' and 'end_date' are required"
}
```

### Website not found
```json
{
  "error": "Website not found: website_abc123"
}
```

---

## Next Steps

1. ✅ Use these APIs to build analytics dashboards
2. ⬜ Add caching for better performance
3. ⬜ Create background jobs for daily aggregation
4. ⬜ Add real-time analytics with WebSockets
5. ⬜ Export data to CSV/PDF

## Related Documentation

- [Analytics Implementation](/docs/implementation/analytics/implementation)
- [Analytics Tracking Script](#)
- [Website Setup Guide](/docs/guides/analytics/website-setup)
