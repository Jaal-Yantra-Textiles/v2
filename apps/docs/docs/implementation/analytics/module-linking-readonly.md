---
title: "Analytics Module Linking - Read-Only Approach ✅"
sidebar_label: "Module Linking (Readonly)"
sidebar_position: 6
---

# Analytics Module Linking - Read-Only Approach ✅

## The Perfect Solution: Read-Only Module Link

We're using a **read-only module link** between Analytics and Website. This gives us the best of both worlds:

✅ **Simple**: Uses existing `website_id` field (no join table)
✅ **Powerful**: Enables `query.graph()` for complex queries
✅ **Fast**: No additional joins or overhead
✅ **Clean**: Leverages MedusaJS's built-in linking system

---

## Implementation

```typescript
// src/links/website-analytics-link.ts
import { defineLink } from "@medusajs/framework/utils";
import WebsiteModule from "../modules/website";
import AnalyticsModule from "../modules/analytics";

export default defineLink(
  {
    linkable: AnalyticsModule.linkable.analyticsEvent,
    field: "website_id",  // ← Use existing field!
  },
  WebsiteModule.linkable.website,
  {
    readOnly: true,  // ← No join table created
  }
);
```

### What this does:
- ✅ Uses the **existing** `website_id` field in `AnalyticsEvent`
- ✅ **No join table** created (read-only)
- ✅ Enables **graph queries** to fetch related data
- ✅ **Zero overhead** - just uses the field that's already there

---

## Usage Examples

### 1. Get Analytics Event with Website Details

```typescript
const query = container.resolve(ContainerRegistrationKeys.QUERY);

const { data } = await query.graph({
  entity: "analytics_event",
  fields: [
    "*",
    "website.*",  // ← Automatically resolves via website_id
  ],
  filters: { id: "event_123" }
});

// Result:
{
  id: "event_123",
  website_id: "website_abc123",
  event_type: "pageview",
  pathname: "/products",
  website: {  // ← Website details included!
    id: "website_abc123",
    domain: "example.com",
    name: "My Website",
    status: "Active"
  }
}
```

### 2. Get Website with All Analytics Events

```typescript
const { data } = await query.graph({
  entity: "website",
  fields: [
    "*",
    "analytics_events.*",  // ← All events for this website
  ],
  filters: { id: "website_abc123" }
});

// Result:
{
  id: "website_abc123",
  domain: "example.com",
  name: "My Website",
  analytics_events: [  // ← All analytics events
    { id: "event_1", event_type: "pageview", pathname: "/" },
    { id: "event_2", event_type: "pageview", pathname: "/products" },
    { id: "event_3", event_type: "custom_event", event_name: "signup" }
  ]
}
```

### 3. Get Recent Events with Website Context

```typescript
const { data } = await query.graph({
  entity: "analytics_event",
  fields: [
    "id",
    "event_type",
    "pathname",
    "timestamp",
    "website.domain",  // ← Just the fields you need
    "website.name",
  ],
  filters: {
    timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  },
  pagination: { take: 100 }
});

// Result: Recent events with minimal website data
[
  {
    id: "event_1",
    event_type: "pageview",
    pathname: "/",
    timestamp: "2024-01-15T10:30:00Z",
    website: {
      domain: "example.com",
      name: "My Website"
    }
  },
  // ...
]
```

### 4. Multi-Website Analytics Dashboard

```typescript
// Get all websites with event counts
const { data: websites } = await query.graph({
  entity: "website",
  fields: [
    "*",
    "analytics_events.id",  // ← Just IDs for counting
  ]
});

// Process results
const websiteStats = websites.map(website => ({
  id: website.id,
  domain: website.domain,
  name: website.name,
  total_events: website.analytics_events?.length || 0
}));

// Result:
[
  { id: "web_1", domain: "site1.com", name: "Site 1", total_events: 1234 },
  { id: "web_2", domain: "site2.com", name: "Site 2", total_events: 567 },
]
```

---

## Comparison: Before vs After

### Before (Simple Reference Only):

```typescript
// Need 2 separate queries
const events = await analyticsService.listAndCountAnalyticsEvents({
  website_id: "website_abc123"
});

const website = await websiteService.retrieveWebsite("website_abc123");

// Manually combine
const result = {
  website: website,
  events: events[0],
  count: events[1]
};
```

### After (Read-Only Link):

```typescript
// Single query with graph
const { data } = await query.graph({
  entity: "website",
  fields: ["*", "analytics_events.*"],
  filters: { id: "website_abc123" }
});

// Already combined!
const result = data[0];  // Has website + events
```

---

## Benefits

### ✅ Performance
- **No join table**: Uses existing `website_id` field
- **No extra queries**: Single graph query gets everything
- **Indexed**: `website_id` is already indexed for fast lookups

### ✅ Simplicity
- **Existing field**: No schema changes needed
- **Read-only**: Can't accidentally modify relationships
- **Type-safe**: MedusaJS handles typing automatically

### ✅ Flexibility
- **Graph queries**: Use powerful `query.graph()` API
- **Selective fields**: Only fetch what you need
- **Nested data**: Get related data in one call

### ✅ Backwards Compatible
- **Still works**: Existing queries with `website_id` still work
- **Optional**: Can use graph queries OR simple queries
- **No breaking changes**: All existing code continues to work

---

## When to Use Each Approach

### Use Simple Query (Direct Service):
```typescript
// ✅ Best for: Simple filtering by website_id
const [events, count] = await analyticsService.listAndCountAnalyticsEvents({
  website_id: "website_abc123",
  event_type: "pageview"
});
```

**Use when:**
- You only need analytics data (no website details)
- Simple filters (website_id, event_type, pathname)
- Pagination and counting
- Maximum performance

### Use Graph Query (With Link):
```typescript
// ✅ Best for: Need website details with analytics
const { data } = await query.graph({
  entity: "analytics_event",
  fields: ["*", "website.domain", "website.name"],
  filters: { id: "event_123" }
});
```

**Use when:**
- Need website details with analytics data
- Building dashboards or reports
- Displaying event with context
- Multi-website overviews

---

## Real-World Examples

### Example 1: Event Details Page

```typescript
// Show event with website context
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  
  const { data } = await query.graph({
    entity: "analytics_event",
    fields: [
      "*",
      "website.id",
      "website.domain",
      "website.name"
    ],
    filters: { id }
  });
  
  res.json({ event: data[0] });
};
```

### Example 2: Website Analytics Dashboard

```typescript
// Show website with recent analytics
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  
  const { data } = await query.graph({
    entity: "website",
    fields: [
      "*",
      "analytics_events.*"
    ],
    filters: { id }
  });
  
  const website = data[0];
  const recentEvents = website.analytics_events
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 100);
  
  res.json({
    website: {
      id: website.id,
      domain: website.domain,
      name: website.name
    },
    recent_events: recentEvents,
    total_events: website.analytics_events.length
  });
};
```

### Example 3: Multi-Website Overview

```typescript
// Admin dashboard: All websites with stats
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  
  const { data: websites } = await query.graph({
    entity: "website",
    fields: [
      "id",
      "domain",
      "name",
      "status",
      "analytics_events.id",
      "analytics_events.timestamp"
    ]
  });
  
  const stats = websites.map(website => {
    const events = website.analytics_events || [];
    const last24h = events.filter(e => 
      new Date(e.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    
    return {
      id: website.id,
      domain: website.domain,
      name: website.name,
      status: website.status,
      total_events: events.length,
      events_24h: last24h.length
    };
  });
  
  res.json({ websites: stats });
};
```

---

## Architecture Diagram

```
┌─────────────────┐
│    Website      │
│  id: "web_123"  │
│  domain: "..."  │
└────────┬────────┘
         │
         │ Read-only link
         │ (uses website_id field)
         │
         ▼
┌──────────────────────┐
│  AnalyticsEvent      │
│  website_id: "web_123" │ ← Existing field!
│  event_type: "..."   │
│  pathname: "..."     │
└──────────────────────┘

No join table created!
Just uses existing website_id field.
```

---

## Summary

The **read-only module link** is the perfect solution because:

1. ✅ **Zero overhead**: Uses existing `website_id` field
2. ✅ **No join table**: Read-only means no extra tables
3. ✅ **Graph queries**: Enables powerful `query.graph()` API
4. ✅ **Backwards compatible**: Existing queries still work
5. ✅ **Type-safe**: MedusaJS handles types automatically
6. ✅ **Flexible**: Use simple OR graph queries as needed

**Best of both worlds!** 🎉

You get the simplicity of a direct field reference AND the power of graph queries, with zero additional overhead.
