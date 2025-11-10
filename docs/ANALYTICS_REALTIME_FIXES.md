# Real-time Analytics - Common Issues & Fixes

## ✅ Fixed: Visitor Double-Counting

### Problem
When a visitor navigates between pages, they were counted as multiple visitors instead of one.

### Root Cause
The system was counting **events** instead of **unique visitor_ids**.

### Solution

#### Backend (`src/api/admin/analytics/live/route.ts`)

```typescript
// ❌ WRONG: Count sessions (can have multiple per visitor)
const currentVisitors = activeSessions.length;

// ✅ CORRECT: Count unique visitor_ids
const uniqueVisitorIds = new Set(recentEvents.map(e => e.visitor_id));
const currentVisitors = uniqueVisitorIds.size;
```

#### Frontend (`src/admin/components/websites/live-analytics-panel.tsx`)

```typescript
// ❌ WRONG: Increment counter on each event
currentVisitors: prev.currentVisitors + 1

// ✅ CORRECT: Recalculate from unique visitor_ids
const uniqueVisitors = new Set(
  recentEvents.map(e => e.visitor_id).filter(Boolean)
);
currentVisitors: uniqueVisitors.size
```

### How It Works Now

```
Visitor browses:
  /home (10:00) → visitor_abc
  /products (10:01) → visitor_abc
  /about (10:02) → visitor_abc

Old behavior:
  Current visitors: 3 ❌ (counted each pageview)

New behavior:
  Current visitors: 1 ✅ (unique visitor_id)
```

---

## Active Page Tracking

### How It Determines Current Page

```typescript
// Get most recent event per visitor
const visitorCurrentPages = new Map<string, string>();

// Events sorted newest first
for (const event of sortedEvents) {
  if (!visitorCurrentPages.has(event.visitor_id)) {
    // First occurrence = most recent page
    visitorCurrentPages.set(event.visitor_id, event.pathname);
  }
}

// Count visitors per page
const activePages = {};
for (const pathname of visitorCurrentPages.values()) {
  activePages[pathname] = (activePages[pathname] || 0) + 1;
}
```

### Example

```
Events (newest first):
  1. visitor_abc → /products (10:02)
  2. visitor_abc → /about (10:01)
  3. visitor_abc → /home (10:00)
  4. visitor_xyz → /home (10:01)

Active pages:
  /products: 1 (visitor_abc is here now)
  /home: 1 (visitor_xyz is here now)
```

---

## Testing

### Verify Unique Counting

```javascript
// 1. Open website in browser
// 2. Open Live Analytics in admin
// 3. Navigate: /home → /products → /about
// 4. Check Live Analytics

Expected:
  Current Visitors: 1 ✅
  Active Pages: /about (1 viewing) ✅

Not:
  Current Visitors: 3 ❌
  Active Pages: /home (1), /products (1), /about (1) ❌
```

### Multi-Visitor Test

```javascript
// 1. Open website in Browser 1
// 2. Open website in Browser 2 (incognito)
// 3. Navigate both browsers

Browser 1: /home → /products
Browser 2: /about

Expected in Live Analytics:
  Current Visitors: 2 ✅
  Unique Visitors: 2 ✅
  Active Pages:
    /products: 1
    /about: 1
```

---

## Implementation Details

### Time Window

```typescript
// Count visitors active in last 5 minutes
const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

const recentEvents = await getEvents({
  timestamp: { $gte: fiveMinutesAgo }
});
```

### Why 5 Minutes?

- ✅ Heartbeat every 30 seconds
- ✅ 10 heartbeats in 5 minutes
- ✅ Enough buffer for network delays
- ✅ Not too long (stale visitors)

### Visitor Lifecycle

```
Visitor arrives:
  00:00 - First pageview
  00:30 - Heartbeat
  01:00 - Heartbeat
  01:30 - Navigate to new page
  02:00 - Heartbeat
  ...
  05:00 - Last heartbeat

After 05:00:
  No more heartbeats
  After 05:00 + 5min buffer = 10:00
  Visitor removed from "current" count
```

---

## Edge Cases Handled

### 1. Rapid Navigation

```
Visitor navigates quickly:
  /home → /products → /about (all within 1 second)

Result:
  Only counts as 1 visitor ✅
  Shows on /about (most recent) ✅
```

### 2. Multiple Tabs

```
Same visitor opens 2 tabs:
  Tab 1: /home
  Tab 2: /products

Result:
  Counts as 1 visitor ✅ (same visitor_id)
  Shows on most recent page ✅
```

### 3. Session Timeout

```
Visitor inactive for 30+ minutes:
  Session ends
  New session starts on return
  
Result:
  Still same visitor_id ✅
  New session_id ✅
  Counts as 1 unique visitor ✅
```

---

## Performance

### Memory Usage

```typescript
// Store last 20 events in frontend
recentEvents: [...prev.recentEvents].slice(0, 20)

// ~20 events × 500 bytes = ~10 KB
// Negligible memory usage ✅
```

### Calculation Overhead

```typescript
// Recalculate on each event
const uniqueVisitors = new Set(recentEvents.map(e => e.visitor_id));

// O(n) where n = 20 events
// ~0.1ms on modern browsers
// Imperceptible ✅
```

---

## Monitoring

### Check Accuracy

```sql
-- Backend query
SELECT 
  COUNT(DISTINCT visitor_id) as unique_visitors,
  COUNT(DISTINCT session_id) as unique_sessions
FROM analytics_event
WHERE website_id = 'xxx'
  AND timestamp > NOW() - INTERVAL '5 minutes';
```

### Compare with UI

```javascript
// Frontend console
console.log('Current Visitors:', liveData.currentVisitors);
console.log('Unique Visitors:', liveData.uniqueVisitors);

// Should match backend query ✅
```

---

## Summary

### What Was Fixed

✅ **Visitor counting** - Now counts unique visitor_ids, not events
✅ **Active pages** - Shows visitor's current page, not all visited pages
✅ **Real-time updates** - Recalculates on each event for accuracy
✅ **Edge cases** - Handles rapid navigation, multiple tabs, etc.

### How It Works

1. Track events with visitor_id and session_id
2. Get events from last 5 minutes
3. Count unique visitor_ids (not events!)
4. Determine current page from most recent event per visitor
5. Display accurate live stats

### Result

🎉 **Accurate real-time visitor tracking!**

- Same visitor navigating = 1 visitor ✅
- Multiple visitors = correct count ✅
- Active pages = current location ✅
- Updates in real-time ✅
