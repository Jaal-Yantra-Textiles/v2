# Real-time Analytics - Phase 5

Live analytics dashboard with Server-Sent Events (SSE) for real-time visitor tracking.

## 🎯 What's Implemented

### ✅ Real-time Features

1. **Live Visitor Counter** - See current visitors in real-time
2. **Live Activity Feed** - Watch pageviews as they happen
3. **Active Pages** - Which pages are being viewed right now
4. **Connection Status** - Visual indicator of live connection
5. **Event Highlighting** - New events flash briefly

---

## 🏗️ Architecture

### Technology Choice: SSE vs WebSockets

We chose **Server-Sent Events (SSE)** over WebSockets because:

✅ **Simpler** - One-way server-to-client streaming
✅ **Auto-reconnect** - Built-in reconnection handling
✅ **HTTP-based** - Works through proxies and firewalls
✅ **Efficient** - Lower overhead for our use case
✅ **Browser native** - No external libraries needed

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser   │         │   Backend    │         │  Admin UI   │
│ (Tracking)  │         │  (MedusaJS)  │         │  (Live View)│
└─────────────┘         └──────────────┘         └─────────────┘
     │                         │                         │
     │ POST /track            │                         │
     ├────────────────────────>│                         │
     │                         │                         │
     │                         │ Emit Event              │
     │                         ├────────>│               │
     │                         │         │               │
     │                         │    Subscriber           │
     │                         │    Catches              │
     │                         │         │               │
     │                         │         │ SSE Stream    │
     │                         │         ├──────────────>│
     │                         │         │               │
     │                         │         │  Update UI    │
     │                         │         │               │
```

---

## 📁 File Structure

```
src/
├── workflows/analytics/
│   └── track-analytics-event.ts        ✅ Emits events
├── subscribers/
│   └── analytics-realtime.ts           ✅ Catches events, broadcasts
├── api/admin/analytics/live/
│   └── route.ts                        ✅ SSE endpoint
└── admin/
    ├── routes/websites/[id]/live/
    │   └── page.tsx                    ✅ Live page route
    └── components/websites/
        ├── live-analytics-panel.tsx    ✅ Live dashboard
        └── website-general-section.tsx ✅ Added "Live" button
```

---

## 🔧 How It Works

### 1. Event Emission (Workflow)

When a tracking event is created, it emits an event:

```typescript
// src/workflows/analytics/track-analytics-event.ts
const eventBus = container.resolve(Modules.EVENT_BUS);

await eventBus.emit({
  name: "analytics_event.created",
  data: event,
});
```

### 2. Event Subscription (Subscriber)

The subscriber catches the event and broadcasts to connected clients:

```typescript
// src/subscribers/analytics-realtime.ts
export default async function analyticsRealtimeSubscriber({ event }: any) {
  const { data } = event;
  
  // Get all SSE connections for this website
  const connections = analyticsConnections.get(data.website_id);
  
  // Broadcast to all connected clients
  connections.forEach((res) => {
    res.write(`data: ${JSON.stringify({ type: 'new_event', data })}\n\n`);
  });
}

export const config: SubscriberConfig = {
  event: "analytics_event.created",
};
```

### 3. SSE Endpoint (API)

Clients connect to the SSE endpoint:

```typescript
// src/api/admin/analytics/live/route.ts
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { website_id } = req.query;

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Add to connection pool
  analyticsConnections.get(website_id).add(res);

  // Send initial stats
  res.write(`data: ${JSON.stringify({ type: 'connected', data: stats })}\n\n`);

  // Heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    connections.delete(res);
  });
};
```

### 4. React Component (Admin UI)

The React component connects and displays live data:

```typescript
// src/admin/components/websites/live-analytics-panel.tsx
useEffect(() => {
  const eventSource = new EventSource(
    `http://localhost:9000/admin/analytics/live?website_id=${websiteId}`
  );

  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === "new_event") {
      setLiveData(prev => ({
        ...prev,
        recentEvents: [message.data, ...prev.recentEvents].slice(0, 20)
      }));
    }
  };

  return () => eventSource.close();
}, [websiteId]);
```

---

## 🚀 Usage

### Access Live Analytics

1. **Navigate to website** in admin panel
2. **Click "Live Analytics"** in action menu (⚡ icon)
3. **Watch real-time data** stream in

### What You'll See

#### **Live Visitor Counter**
```
┌─────────────────────────────┐
│ ● Live                      │
│                             │
│ Current Visitors            │
│       5                     │
│       3 unique              │
└─────────────────────────────┘
```

#### **Active Pages**
```
┌─────────────────────────────┐
│ Active Pages                │
├─────────────────────────────┤
│ /products      3 viewing    │
│ /              2 viewing    │
│ /about         1 viewing    │
└─────────────────────────────┘
```

#### **Live Activity Feed**
```
┌─────────────────────────────┐
│ Live Activity               │
├─────────────────────────────┤
│ [pageview] /products        │
│ from google • desktop       │
│ 10:45:23 AM                 │
├─────────────────────────────┤
│ [pageview] /                │
│ direct • mobile             │
│ 10:45:20 AM                 │
└─────────────────────────────┘
```

---

## 🎨 UI Features

### Connection Status Indicator

```tsx
<span className={`w-3 h-3 rounded-full ${
  isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
}`} />
```

- 🟢 **Green pulsing** = Connected
- 🔴 **Red** = Disconnected

### Event Highlighting

New events flash blue for 2 seconds:

```tsx
const [isNew, setIsNew] = useState(true);

useEffect(() => {
  const timer = setTimeout(() => setIsNew(false), 2000);
  return () => clearTimeout(timer);
}, []);

<div className={isNew ? "bg-blue-50" : ""}>
  {/* Event content */}
</div>
```

### Auto-scroll

Activity feed auto-scrolls to show latest events:

```tsx
<div className="max-h-96 overflow-y-auto">
  {recentEvents.map(event => <LiveEventRow event={event} />)}
</div>
```

---

## 📊 Data Flow

### Initial Connection

```
1. User opens Live Analytics page
2. EventSource connects to /admin/analytics/live?website_id=...
3. Server sends initial stats:
   {
     type: "connected",
     data: {
       currentVisitors: 5,
       uniqueVisitors: 3,
       recentEvents: [...],
       activePages: [...]
     }
   }
4. UI displays initial data
```

### Real-time Updates

```
1. Visitor views page on website
2. POST /web/analytics/track (includes visitor_id, session_id)
3. Workflow creates event
4. Workflow emits "analytics_event.created"
5. Subscriber catches event
6. Subscriber broadcasts to SSE connections
7. Admin UI receives event
8. UI recalculates unique visitors:
   - Extracts visitor_id from all recent events
   - Counts unique visitor_ids (not event count!)
   - Updates active pages from latest event per visitor
9. UI displays accurate count
```

### Visitor Tracking Logic

```typescript
// Backend: Count unique visitors from recent events
const recentEvents = getEventsFromLast5Minutes();
const uniqueVisitors = new Set(recentEvents.map(e => e.visitor_id));
const currentVisitors = uniqueVisitors.size; // ✅ Correct count

// Frontend: Same logic on each new event
const uniqueVisitors = new Set(
  recentEvents.map(e => e.visitor_id).filter(Boolean)
);
```

### Active Page Tracking

```typescript
// Get the most recent page for each visitor
const visitorCurrentPages = new Map<string, string>();

for (const event of sortedEventsByTime) {
  if (!visitorCurrentPages.has(event.visitor_id)) {
    visitorCurrentPages.set(event.visitor_id, event.pathname);
  }
}

// Now count visitors per page
// If visitor navigates: /home → /products
// They only count once on /products (latest page)
```

### Heartbeat

```
Every 30 seconds:
  Server sends: ": heartbeat\n\n"
  Keeps connection alive
  Prevents timeout
```

---

## 🔒 Security

### Authentication

The SSE endpoint is under `/admin/analytics/live`, which requires:
- ✅ Admin authentication
- ✅ Valid session
- ✅ Proper permissions

### Data Privacy

Only sends necessary data:
- ❌ No PII (names, emails)
- ❌ No IP addresses
- ✅ Anonymous visitor IDs
- ✅ Page paths only
- ✅ Aggregated stats

---

## ⚡ Performance

### Connection Management

```typescript
// In-memory connection pool
const analyticsConnections = new Map<string, Set<any>>();

// Automatic cleanup on disconnect
req.on("close", () => {
  connections.delete(res);
  if (connections.size === 0) {
    analyticsConnections.delete(website_id);
  }
});
```

### Memory Usage

```
Per connection: ~1-2 KB
100 connections: ~100-200 KB
1000 connections: ~1-2 MB

Very lightweight! ✅
```

### Network Usage

```
Initial connection: ~5 KB
Per event: ~500 bytes
Heartbeat: ~10 bytes

Minimal bandwidth! ✅
```

---

## 🐛 Troubleshooting

### Connection Fails

**Symptom:** Red dot, "Disconnected"

**Solutions:**
```bash
# 1. Check backend is running
curl http://localhost:9000/admin/analytics/live?website_id=xxx

# 2. Check CORS settings
# Add to .env:
WEB_CORS=http://localhost:7001

# 3. Check browser console
# Look for EventSource errors
```

### No Events Showing

**Symptom:** Connected but no activity

**Solutions:**
```bash
# 1. Verify tracking is working
# Check browser console on website
# Should see: [Analytics] Initialized

# 2. Check event emission
# Add logging to workflow:
console.log("[Analytics] Event created:", event);

# 3. Check subscriber
# Add logging to subscriber:
console.log("[Analytics] Broadcasting to", connections.size, "clients");
```

### Events Delayed

**Symptom:** Events show up late

**Solutions:**
```typescript
// 1. Check subscriber is registered
// File must be in src/subscribers/

// 2. Check event name matches
// Workflow: "analytics_event.created"
// Subscriber: "analytics_event.created"

// 3. Reduce heartbeat interval
const heartbeat = setInterval(() => {
  res.write(`: heartbeat\n\n`);
}, 10000); // 10 seconds instead of 30
```

---

## 🎯 Next Steps

### Enhancements

1. **Visitor Map**
   ```typescript
   // Show visitors on world map
   // Requires GeoIP lookup
   ```

2. **Real-time Charts**
   ```typescript
   // Live updating line charts
   // Show traffic trends
   ```

3. **Alerts**
   ```typescript
   // Alert on traffic spikes
   // Alert on errors
   ```

4. **Session Replay**
   ```typescript
   // Record and replay user sessions
   // See exactly what users do
   ```

---

## 📈 Monitoring

### Key Metrics

1. **Active Connections**
   ```typescript
   console.log("Active connections:", analyticsConnections.size);
   ```

2. **Events Broadcasted**
   ```typescript
   let eventCount = 0;
   // Increment on each broadcast
   ```

3. **Connection Duration**
   ```typescript
   const connectionStart = Date.now();
   req.on("close", () => {
     const duration = Date.now() - connectionStart;
     console.log("Connection lasted:", duration, "ms");
   });
   ```

---

## ✅ Testing

### Manual Test

1. **Open Live Analytics**
   ```
   http://localhost:9000/app/websites/01JM1PEW9H0ES7GGMD173GM2T9/live
   ```

2. **Open Website in Another Tab**
   ```
   http://localhost:3000
   ```

3. **Navigate Around**
   - Click links
   - View different pages
   - Watch Live Analytics update!

### Automated Test

```typescript
// Test SSE connection
const eventSource = new EventSource(
  "http://localhost:9000/admin/analytics/live?website_id=xxx"
);

eventSource.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log("Received:", message);
};

// Trigger tracking event
await fetch("http://localhost:9000/web/analytics/track", {
  method: "POST",
  body: JSON.stringify({
    website_id: "xxx",
    event_type: "pageview",
    pathname: "/test",
    // ...
  })
});

// Should see event in SSE stream!
```

---

## 🎉 Summary

You now have **real-time analytics**!

### What Works:
✅ Live visitor counter
✅ Real-time activity feed
✅ Active pages tracking
✅ Auto-reconnection
✅ Event highlighting
✅ Connection status
✅ Minimal overhead

### How to Use:
1. Click "Live Analytics" button
2. Watch visitors in real-time
3. See events as they happen
4. Monitor active pages

**Your analytics system is now truly live!** 🚀📊⚡
