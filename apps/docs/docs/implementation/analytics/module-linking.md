---
title: "Analytics Module Linking - Analysis & Decision"
sidebar_label: "Module Linking"
sidebar_position: 5
---

# Analytics Module Linking - Analysis & Decision

## Question: Should we use module linking between Website and Analytics?

## Answer: **OPTIONAL** - Not necessary, but can be useful for advanced queries

---

## Current Approach (Simple Reference)

### How it works:
```typescript
// Analytics events store website_id as a simple text field
AnalyticsEvent {
  website_id: "website_abc123",  // ← Simple string reference
  event_type: "pageview",
  pathname: "/products",
  // ...
}
```

### Querying:
```typescript
// Get analytics for a website
const [events, count] = await analyticsService.listAndCountAnalyticsEvents({
  website_id: "website_abc123"
});

// Get website separately if needed
const website = await websiteService.retrieveWebsite("website_abc123");
```

### ✅ Pros:
- **Simple**: Just a string ID - easy to understand
- **Fast**: Direct index lookup on `website_id`
- **Flexible**: Can filter by website_id easily
- **No overhead**: No join tables or link resolution
- **Already working**: All tests passing

### ❌ Cons:
- **Separate queries**: Need 2 queries to get website + analytics
- **No graph queries**: Can't use `query.graph()` to fetch both at once
- **Manual validation**: Need to check if website exists separately

---

## With Module Linking

### Setup:
```typescript
// src/links/website-analytics-link.ts
export default defineLink(
  { linkable: WebsiteModule.linkable.website, isList: true },
  { linkable: AnalyticsModule.linkable.analyticsEvent, isList: true }
);
```

### What it enables:

#### 1. Get website with all analytics events
```typescript
const query = container.resolve(ContainerRegistrationKeys.QUERY);

const { data } = await query.graph({
  entity: "website",
  fields: [
    "*",
    "analytics_events.*",  // ← All analytics events for this website
  ],
  filters: { id: "website_abc123" }
});

// Result:
{
  id: "website_abc123",
  domain: "example.com",
  name: "My Website",
  analytics_events: [
    { id: "event_1", event_type: "pageview", pathname: "/" },
    { id: "event_2", event_type: "pageview", pathname: "/products" },
    // ... all events
  ]
}
```

#### 2. Get analytics event with website details
```typescript
const { data } = await query.graph({
  entity: "analytics_event",
  fields: [
    "*",
    "website.*",  // ← Website details
  ],
  filters: { id: "event_123" }
});

// Result:
{
  id: "event_123",
  event_type: "pageview",
  pathname: "/products",
  website: {
    id: "website_abc123",
    domain: "example.com",
    name: "My Website"
  }
}
```

#### 3. Complex queries with filters
```typescript
const { data } = await query.graph({
  entity: "website",
  fields: [
    "*",
    "analytics_events.*"
  ],
  filters: {
    domain: "example.com",
    // Note: Can't filter on linked entity properties directly
    // Would need to filter in application code
  }
});
```

### ✅ Pros:
- **Single query**: Get website + analytics in one call
- **Graph queries**: Use powerful `query.graph()` API
- **Automatic joins**: MedusaJS handles the linking
- **Type safety**: Better TypeScript support

### ❌ Cons:
- **Complexity**: Adds another layer of abstraction
- **Performance**: May be slower for simple queries (joins overhead)
- **Limited filtering**: Can't filter on linked entity properties in query.graph
- **Overkill**: Most analytics queries don't need website details

---

## Real-World Use Cases

### ✅ **When simple reference is enough** (90% of cases):

1. **Tracking events** - Just need website_id
   ```typescript
   POST /web/analytics/track
   { website_id: "abc", event_type: "pageview", ... }
   ```

2. **Querying analytics** - Filter by website_id
   ```typescript
   GET /admin/analytics-events?website_id=abc
   ```

3. **Dashboard stats** - Aggregate by website_id
   ```typescript
   SELECT COUNT(*) FROM analytics_event WHERE website_id = 'abc'
   ```

4. **Reporting** - Group by website_id
   ```typescript
   SELECT website_id, COUNT(*) FROM analytics_event GROUP BY website_id
   ```

### ✅ **When module linking helps** (10% of cases):

1. **Admin dashboard** - Show website details with analytics
   ```typescript
   // Get website + recent events in one query
   const { data } = await query.graph({
     entity: "website",
     fields: ["*", "analytics_events.*"],
     filters: { id: websiteId }
   });
   ```

2. **Multi-website overview** - List all websites with event counts
   ```typescript
   // Get all websites with their analytics
   const { data } = await query.graph({
     entity: "website",
     fields: ["*", "analytics_events.id"],  // Just count
   });
   ```

3. **Event details page** - Show event with website context
   ```typescript
   // Get event + website details
   const { data } = await query.graph({
     entity: "analytics_event",
     fields: ["*", "website.*"],
     filters: { id: eventId }
   });
   ```

---

## Recommendation

### **For your current needs: Keep it simple (no module linking)**

**Reasons:**
1. ✅ Your analytics queries are primarily filtered by `website_id`
2. ✅ You rarely need website details when viewing analytics
3. ✅ Simple approach is faster and easier to understand
4. ✅ All tests are passing with current implementation
5. ✅ Can always add module linking later if needed

### **When to add module linking:**

Add it **IF** you find yourself frequently doing:
```typescript
// Fetching website details for every analytics query
const events = await getAnalytics(websiteId);
const website = await getWebsite(websiteId);  // ← Repetitive

// Better with module linking:
const { data } = await query.graph({
  entity: "analytics_event",
  fields: ["*", "website.name", "website.domain"]
});
```

---

## Implementation Status

### ✅ Current (Simple Reference):
- [x] Analytics events store `website_id` as text
- [x] Indexed for fast queries
- [x] All tests passing
- [x] Works perfectly for tracking and reporting

### ⬜ Optional (Module Linking):
- [x] Link file created: `src/links/website-analytics-link.ts`
- [ ] Update module exports to include `linkable`
- [ ] Test graph queries
- [ ] Update documentation

---

## Conclusion

**Keep the simple approach for now.** Module linking is available if you need it later, but it's not necessary for the core analytics functionality. The simple `website_id` reference is:
- ✅ Faster
- ✅ Simpler
- ✅ Easier to understand
- ✅ Sufficient for 90% of use cases

You can always add module linking later if you find yourself needing complex queries that join website and analytics data.
